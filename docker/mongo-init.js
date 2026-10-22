// Runs once, when the mongodata volume is first created.
db.getSiblingDB("sessionDB").createUser({
  user: "tracetray",
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: "sessionDB" }],
});
