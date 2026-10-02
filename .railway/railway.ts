import { defineRailway, github, service } from "railway/iac";

export default defineRailway(() => {
  const aplikasiTrip = service("aplikasi-trip", {
    source: github("444Nazky/Aplikasi-Trip-Ionic", { checkSuites: true }),
    replicas: { "sfo": 1 },
  });

  const aplikasiTripApi = service("aplikasi-trip-api", {
    source: github("444Nazky/Aplikasi-Trip-Ionic", { checkSuites: true }),
    rootDirectory: "/backend",
    dockerfilePath: "/Dockerfile",
    volumes: [{ mountPath: "/data" }],
    variables: { DB_PATH: "/data/trip.db", UPLOADS_DIR: "/data/uploads" },
    replicas: { "sfo": 1 },
  });

  return {
    name: "aplikasi-trip",
    services: [aplikasiTrip, aplikasiTripApi],
  };
});
