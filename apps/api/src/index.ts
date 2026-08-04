import { buildServer } from "./server"

const port = Number(process.env.PORT ?? 3000)

buildServer()
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`api listening on :${port}`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
