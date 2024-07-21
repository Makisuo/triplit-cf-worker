import { createServer } from "./server"

console.log("Hono Running!")

const server = createServer({
	verboseLogs: true,
})

console.log("Hono Running!")

export default server
