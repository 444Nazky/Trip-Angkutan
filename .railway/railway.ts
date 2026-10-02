import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const aplikasiTrip = service("aplikasi-trip", {
    source: github("444Nazky/Aplikasi-Trip-Ionic", { checkSuites: true }),
    replicas: { "sfo": 1 },
  });

  return project("aplikasi-trip", {
    resources: [aplikasiTrip],
  });
});
