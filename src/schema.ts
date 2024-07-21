import { type Models, type Roles, Schema as S } from "@triplit/db"

export const roles: Roles = {
	user: {
		match: {
			"x-triplit-user-id": "$userId",
		},
	},
}

const lifecyleFields = {
	createdAt: S.Date({ default: S.Default.now() }),
	updatedAt: S.Date({ default: S.Default.now() }),
}

const defaultFields = {
	id: S.Id(),
	...lifecyleFields,
}

export const schema = {
	users: {
		schema: S.Schema({
			licenseKey: S.String({ nullable: true }),

			totalAproxCost: S.Number({ default: 0 }),

			renders: S.RelationMany("renders", {
				where: [["userId", "=", "$id"]],
			}),

			projects: S.RelationMany("projects", {
				where: [["userId", "=", "$id"]],
			}),

			...defaultFields,
		}),
	},
	projects: {
		schema: S.Schema({
			name: S.String(),
			userId: S.String(),
			settings: S.Record({
				beforeImage: S.String({ nullable: true }),
				afterImage: S.String({ nullable: true }),

				sliderType: S.String({ enum: ["line", "logo", "fade"] }),
				sliderColor: S.String(),
				sliderLogo: S.String({ nullable: true }),

				direction: S.String({ enum: ["horizontal", "vertical"] }),
				backgroundColor: S.String({ nullable: true }),

				padding: S.Number(),
				radius: S.Number(),
			}),

			videoSettings: S.Record({
				fps: S.Number(),
				duration: S.Number(),
				resolution: S.Number(),
				aspectRatio: S.Number(),
				fileName: S.String(),
			}),

			...defaultFields,
		}),
	},
	renders: {
		schema: S.Schema({
			projectId: S.String(),
			userId: S.String(),
			fileUrl: S.String({ nullable: true }),

			progress: S.Number(),

			status: S.String({ enum: ["pending", "done", "error"], default: "pending" }),

			...defaultFields,
		}),
	},
} satisfies Models<any, any>
