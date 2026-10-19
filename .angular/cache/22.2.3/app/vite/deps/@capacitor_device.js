import { registerPlugin } from "./@capacitor_core.js";
//#region node_modules/@capacitor/device/dist/esm/index.js
var Device = registerPlugin("Device", { web: () => import("./web-C8ChANo-.js").then((m) => new m.DeviceWeb()) });
//#endregion
export { Device };
