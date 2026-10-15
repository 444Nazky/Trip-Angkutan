import { registerPlugin } from "./@capacitor_core.js";
//#region node_modules/@capacitor/app/dist/esm/index.js
var App = registerPlugin("App", { web: () => import("./web-8YuiPUEH.js").then((m) => new m.AppWeb()) });
//#endregion
export { App };
