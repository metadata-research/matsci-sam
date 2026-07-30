export const GET = () =>
  new Response(null, {
    status: 307,
    headers: { Location: "/login" }
  })
