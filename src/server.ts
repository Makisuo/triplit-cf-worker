import {
	DB,
	type DBConfig,
	DurableClock,
	type Storage,
	TriplitError,
} from "@triplit/db";
import {
	type ClientSyncMessage,
	type ParseResult,
	type ServerCloseReason,
	Server as TriplitServer,
} from "@triplit/server-core";
import { MalformedMessagePayloadError } from "@triplit/server-core/errors";
import {
	type ProjectJWT,
	parseAndValidateToken,
} from "@triplit/server-core/token";
import type { Route } from "@triplit/server-core/triplit-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
import { logger } from "./logger.js";
import {
	type StoreKeys,
	defaultArrayStorage,
	defaultBTreeStorage,
	defaultFileStorage,
	defaultLMDBStorage,
	defaultLevelDBStorage,
	defaultMemoryStorage,
	defaultSQLiteStorage,
} from "./storage.js";

function resolveStorageStringOption(storage: StoreKeys): Storage {
	switch (storage) {
		case "file":
			return defaultFileStorage();
		case "leveldb":
			return defaultLevelDBStorage();
		case "lmdb":
			return defaultLMDBStorage();
		case "memory":
			return defaultMemoryStorage();
		case "memory-array":
			return defaultBTreeStorage();
		case "memory-btree":
			return defaultArrayStorage();
		case "sqlite":
			return defaultSQLiteStorage();
		default:
			throw new TriplitError(`Invalid storage option: ${storage}`);
	}
}

export type ServerOptions = {
	storage?: StoreKeys | Storage | (() => Storage);
	dbOptions?: DBConfig<any>;
	watchMode?: boolean;
	verboseLogs?: boolean;
};

export function createServer(options?: ServerOptions) {
	const app = new Hono();

	if (options?.verboseLogs) logger.verbose = true;

	const dbSource = !!options?.storage
		? typeof options.storage === "string"
			? resolveStorageStringOption(options.storage)
			: typeof options.storage === "function"
				? options.storage()
				: options.storage
		: undefined;

	const triplitServers = new Map<string, TriplitServer>();

	function getServer(projectId: string) {
		if (triplitServers.has(projectId)) return triplitServers.get(projectId)!;
		const server = new TriplitServer(
			new DB({
				source: dbSource,
				tenantId: projectId,
				clock: new DurableClock(),
				...(options?.dbOptions ?? {}),
			}),
		);
		triplitServers.set(projectId, server);
		return server;
	}

	app.use("*", cors());
	app.use("/api/*", jwt({ secret: process.env.JWT_SECRET! }));

	app.post("/api/message", async (c) => {
		try {
			const { message, options } = await c.req.json();
			const { clientId } = options;
			const triplitServer = getServer(process.env.PROJECT_ID!);
			const session = triplitServer.getConnection(clientId);
			if (!session) {
				throw new Error("NO CONNECTION OPEN!");
			}
			await session.dispatchCommand(message);
			return c.json({ success: true }, 200);
		} catch (e) {
			console.error(e);
			captureException(e);
			return c.json({ error: "Internal Server Error" }, 500);
		}
	});

	app.post("/api/*", async (c) => {
		const path = c.req.path.split("/").slice(2) as Route;
		const body = await c.req.json();
		const token = c.get("jwtPayload");
		const triplitServer = getServer(process.env.PROJECT_ID!);
		const { statusCode, payload } = await triplitServer.handleRequest(
			path,
			body,
			token,
		);
		return c.json(payload, statusCode);
	});

	app.get("/message-events", async (c) => {
		const { schema, client, syncSchema, token: rawToken } = c.req.query();
		const { data: token, error } = await parseAndValidateToken(
			rawToken as string,
			process.env.JWT_SECRET!,
			process.env.PROJECT_ID!,
			{
				payloadPath: process.env.CLAIMS_PATH,
				externalSecret: process.env.EXTERNAL_JWT_SECRET,
			},
		);
		if (error) {
			captureException(error);
			return c.json({ error: "Unauthorized" }, 401);
		}

		const triplitServer = getServer(process.env.PROJECT_ID!);
		const connection = triplitServer.openConnection(token, {
			clientId: client as string,
			clientSchemaHash: schema ? Number.parseInt(schema as string) : undefined,
			syncSchema: syncSchema === "true",
		});

		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		const schemaIncompatibility = await connection.isClientSchemaCompatible();
		if (schemaIncompatibility) {
			await writer.write(
				encoder.encode(
					`data: ${JSON.stringify({
						type: "CLOSE",
						payload: schemaIncompatibility,
					})}\n\n`,
				),
			);
			await writer.close();
		} else {
			const unsubscribe = connection.addListener((messageType, payload) => {
				writer.write(
					encoder.encode(
						`data: ${JSON.stringify({ type: messageType, payload })}\n\n`,
					),
				);
			});

			c.executionCtx.waitUntil(
				(async () => {
					await c.req.signal.aborted;
					unsubscribe();
					await writer.close();
				})(),
			);
		}

		return c.newResponse(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	return app;
}
