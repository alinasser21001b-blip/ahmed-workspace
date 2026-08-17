# Intentionally empty

Deploy Previews and branch deploys point their `functions` directory here so
that a preview deploy carries no serverless function.

That is what stops a student preview from reaching the API: with nothing
deployed at `/.netlify/functions/api`, the `/v1/*` redirect in `netlify.toml`
resolves to nothing and returns 404. The preview's client never issues such a
request anyway — its transport is an in-memory fixture world — but the two
guarantees are independent, and a safety property with two independent reasons
holds when one of them is wrong.

Do not add functions here.
