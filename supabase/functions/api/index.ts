// API Edge Function - replaces the Express backend, fully on Supabase.
import * as authh from "./handlers/auth.ts";
import * as geo from "./handlers/geofences.ts";
import * as mst from "./handlers/master.ts";
import * as rt from "./handlers/regionTariffs.ts";
import * as rts from "./handlers/routes.ts";
import * as trps from "./handlers/trips.ts";
import * as rprt from "./handlers/reports.ts";
import * as ofc from "./handlers/officers.ts";
import * as plt from "./handlers/plates.ts";
import * as upd from "./handlers/appVersion.ts";
import { corsHeaders, json } from "./_shared.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let p = url.searchParams.get("path") ?? url.pathname.replace(/^\/functions\/v1\/api\/?/, "");
  const path = (p.startsWith("/") ? p : `/${p}`).replace(/^\/api(?=\/|$)/, "") || "/";
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  const [a, b, c] = parts;

  const notFound = () => json({ error: `Endpoint not found: ${req.method} /${parts.join("/")}` }, 404);

  try {
    // ---------------- /health ----------------
    if (a === "health" && req.method === "GET") {
      return json({ status: "ok", version: "3.0.0-supabase-only" });
    }

    // ---------------- /auth ----------------
    if (a === "auth" && req.method === "POST") {
      switch (b) {
        case "admin-login": return await authh.adminLogin(req);
        case "region-login": return await authh.regionLogin(req);
        case "member-login": return await authh.memberLogin(req);
        case "login": return await authh.login(req);
        case "select-dermaga": return await authh.selectDermaga(req);
        case "refresh": return await authh.refreshToken(req);
        case "change-admin-password": return await authh.changeAdminPassword(req);
      }
      return notFound();
    }

    // ---------------- /geofences ----------------
    if (a === "geofences") {
      if (req.method === "GET" && b === "resolve-link") return await geo.resolveLink(req, url);
      if (req.method === "GET" && !b) return await geo.getGeofences(req, url);
      if (req.method === "POST" && !b) return await geo.createGeofence(req);
      if (req.method === "PUT" && b) return await geo.updateGeofence(req, b);
      if (req.method === "DELETE" && b) return await geo.deleteGeofence(req, b);
      return notFound();
    }

    // ---------------- /regions ----------------
    if (a === "regions") {
      if (req.method === "GET" && !b) return await mst.getRegions(req);
      if (req.method === "POST" && !b) return await mst.createRegion(req);
      if (req.method === "PUT" && b) return await mst.updateRegion(req, b);
      if (req.method === "DELETE" && b) return await mst.deleteRegion(req, b);
      return notFound();
    }

    // ---------------- /dermagas + nested ----------------
    if (a === "dermagas") {
      if (req.method === "GET" && !b) return await mst.getDermagas(req);
      if (req.method === "POST" && !b) return await mst.createDermaga(req);
      if (req.method === "PUT" && b && !c) return await mst.updateDermaga(req, b);
      if (req.method === "DELETE" && b && !c) return await mst.deleteDermaga(req, b);
      return notFound();
    }

    // ---------------- /routes ----------------
    if (a === "routes") {
      if (req.method === "GET" && b === "mine") return await rts.getOfficerRoutes(req);
      if (req.method === "GET" && !b) return await rts.getAllRoutes(req);
      if (req.method === "POST" && !b) return await rts.createRoute(req);
      if (req.method === "PUT" && b) return await rts.updateRoute(req, b);
      if (req.method === "DELETE" && b) return await rts.deleteRoute(req, b);
      return notFound();
    }

    // ---------------- /tariffs (admin) ----------------
    if (a === "tariffs") {
      if (req.method === "GET" && !b) return await mst.getAdminTariffs(req);
      if (req.method === "POST" && !b) return await mst.createTariff(req);
      if (req.method === "PUT" && b) return await mst.updateTariff(req, b);
      if (req.method === "DELETE" && b) return await mst.deleteTariff(req, b);
      return notFound();
    }

    // ---------------- /master/tariffs (officer) ----------------
    if (a === "master" && b === "tariffs" && req.method === "GET") {
      return await mst.getMasterTariffs(req);
    }

    // ---------------- /region-tariffs ----------------
    if (a === "region-tariffs") {
      if (req.method === "GET" && !b) return await rt.getRegionTariffs(req);
      if (req.method === "PUT" && b) return await rt.updateRegionTariff(req, b);
      return notFound();
    }

    // ---------------- /trips ----------------
    if (a === "trips") {
      if (req.method === "POST" && b === "complete") return await trps.completeTrip(req);
      if (req.method === "POST" && !b) return await trps.createTrip(req);
      if (req.method === "GET" && !b) return await trps.getTrips(req, url);
      return notFound();
    }

    // ---------------- /reports ----------------
    if (a === "reports") {
      if (req.method === "GET" && b === "summary") return await rprt.summary(req, url);
      if (req.method === "GET" && b === "trips" && c === "filters") return await rprt.tripFilters(req);
      if (req.method === "GET" && b === "trips") return await rprt.tripsReport(req, url);
      return notFound();
    }

    // ---------------- /officers ----------------
    if (a === "officers") {
      if (req.method === "GET" && !b) return await ofc.getOfficers(req);
      if (req.method === "GET" && b === "my-region") return await ofc.myRegionOfficers(req);
      if (req.method === "POST" && !b) return await ofc.createOfficer(req);
      if (req.method === "PUT" && b && c === "dermagas") return await ofc.updateOfficerDermagas(req, b);
      if (req.method === "PUT" && b && c === "regions") return await ofc.updateOfficerRegions(req, b);
      if (req.method === "PUT" && b && c === "pin") return await ofc.updateOfficerPin(req, b);
      if (req.method === "PUT" && b && c === "status") return await ofc.updateOfficerStatus(req, b);
      if (req.method === "DELETE" && b) return await ofc.deleteOfficer(req, b);
      return notFound();
    }

    // ---------------- /plates ----------------
    if (a === "plates") {
      if (req.method === "GET" && !b) return await plt.getPlates(req, url);
      if (req.method === "POST" && b === "check") return await plt.checkPlate(req);
      if (req.method === "POST" && !b) return await plt.createPlate(req);
      if (req.method === "PUT" && b) return await plt.updatePlate(req, b);
      if (req.method === "DELETE" && b) return await plt.deletePlate(req, b);
      return notFound();
    }

    // ---------------- app update / OTA ----------------
    if (a === "app-version" && req.method === "GET") return await upd.getAppVersion(req, url);
    if (a === "release-notes" && req.method === "GET" && b) return await upd.releaseNotes(req, b);
    if (a === "apk-list" && req.method === "GET") return await upd.apkList(req);
    if (a === "publish-version" && req.method === "POST") return await upd.publishVersion(req);
    if (a === "app-download" && req.method === "GET" && b) return await upd.appDownload(req, b);
    if (a === "ota-manifest" && req.method === "GET") return await upd.otaManifest(req);
    if (a === "ota-versions" && req.method === "GET") return await upd.otaVersions(req);
    if (a === "publish-ota" && req.method === "POST") return await upd.publishOta(req);
    if (a === "report-version" && req.method === "POST") return await upd.reportDeviceVersion(req);
    if (a === "device-versions" && req.method === "GET") return await upd.deviceVersions(req);

    return notFound();
  } catch (error) {
    console.error("[api]", req.method, path, error);
    return json({ error: "Internal error" }, 500);
  }
});
