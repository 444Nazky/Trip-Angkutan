import { defineRailway, github, service } from "railway/iac";

export default defineRailway(() => {
  const aplikasiTrip = service("aplikasi-trip-web", {
    source: github("444Nazky/Aplikasi-Trip-Ionic", { checkSuites: true }),
    replicas: { "sfo": 1 },
  });

  const aplikasiTripApi = service("aplikasi-trip-api", {
    source: github("444Nazky/Aplikasi-Trip-Ionic", { checkSuites: true }),
    rootDirectory: "/backend",
    dockerfilePath: "/backend/Dockerfile",
    replicas: { "sfo": 1 },
  });

  return {
    name: "aplikasi-trip",
    services: [aplikasiTrip, aplikasiTripApi],
  };
});
