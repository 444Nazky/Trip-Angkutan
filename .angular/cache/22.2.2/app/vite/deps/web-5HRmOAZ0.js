import { WebPlugin } from "./@capacitor_core.js";
//#region node_modules/@capacitor-community/sqlite/dist/esm/web.js
var CapacitorSQLiteWeb = class extends WebPlugin {
	constructor() {
		super(...arguments);
		this.jeepSqliteElement = null;
		this.isWebStoreOpen = false;
	}
	async initWebStore() {
		await customElements.whenDefined("jeep-sqlite");
		this.jeepSqliteElement = document.querySelector("jeep-sqlite");
		this.ensureJeepSqliteIsAvailable();
		this.jeepSqliteElement.addEventListener("jeepSqliteImportProgress", (event) => {
			this.notifyListeners("sqliteImportProgressEvent", event.detail);
		});
		this.jeepSqliteElement.addEventListener("jeepSqliteExportProgress", (event) => {
			this.notifyListeners("sqliteExportProgressEvent", event.detail);
		});
		this.jeepSqliteElement.addEventListener("jeepSqliteHTTPRequestEnded", (event) => {
			this.notifyListeners("sqliteHTTPRequestEndedEvent", event.detail);
		});
		this.jeepSqliteElement.addEventListener("jeepSqlitePickDatabaseEnded", (event) => {
			this.notifyListeners("sqlitePickDatabaseEndedEvent", event.detail);
		});
		this.jeepSqliteElement.addEventListener("jeepSqliteSaveDatabaseToDisk", (event) => {
			this.notifyListeners("sqliteSaveDatabaseToDiskEvent", event.detail);
		});
		if (!this.isWebStoreOpen) this.isWebStoreOpen = await this.jeepSqliteElement.isStoreOpen();
	}
	async saveToStore(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.saveToStore(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getFromLocalDiskToStore(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.getFromLocalDiskToStore(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async saveToLocalDisk(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.saveToLocalDisk(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async echo(options) {
		this.ensureJeepSqliteIsAvailable();
		return await this.jeepSqliteElement.echo(options);
	}
	async createConnection(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.createConnection(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async open(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.open(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async closeConnection(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.closeConnection(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getVersion(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.getVersion(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async checkConnectionsConsistency(options) {
		this.ensureJeepSqliteIsAvailable();
		try {
			return await this.jeepSqliteElement.checkConnectionsConsistency(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async close(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.close(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async beginTransaction(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.beginTransaction(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async commitTransaction(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.commitTransaction(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async rollbackTransaction(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.rollbackTransaction(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isTransactionActive(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isTransactionActive(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getTableList(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.getTableList(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async execute(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.execute(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async executeSet(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.executeSet(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async run(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.run(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async query(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.query(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isDBExists(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isDBExists(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isDBOpen(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isDBOpen(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isDatabase(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isDatabase(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isTableExists(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isTableExists(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async deleteDatabase(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.deleteDatabase(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async isJsonValid(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.isJsonValid(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async importFromJson(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.importFromJson(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async exportToJson(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.exportToJson(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async createSyncTable(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.createSyncTable(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async setSyncDate(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.setSyncDate(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getSyncDate(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.getSyncDate(options);
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async deleteExportedRows(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.deleteExportedRows(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async addUpgradeStatement(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.addUpgradeStatement(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async copyFromAssets(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.copyFromAssets(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getFromHTTPRequest(options) {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			await this.jeepSqliteElement.getFromHTTPRequest(options);
			return;
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	async getDatabaseList() {
		this.ensureJeepSqliteIsAvailable();
		this.ensureWebstoreIsOpen();
		try {
			return await this.jeepSqliteElement.getDatabaseList();
		} catch (err) {
			throw new Error(`${err}`);
		}
	}
	/**
	* Checks if the `jeep-sqlite` element is present in the DOM.
	* If it's not in the DOM, this method throws an Error.
	*
	* Attention: This will always fail, if the `intWebStore()` method wasn't called before.
	*/
	ensureJeepSqliteIsAvailable() {
		if (this.jeepSqliteElement === null) throw new Error(`The jeep-sqlite element is not present in the DOM! Please check the @capacitor-community/sqlite documentation for instructions regarding the web platform.`);
	}
	ensureWebstoreIsOpen() {
		if (!this.isWebStoreOpen)
 /**
		* if (!this.isWebStoreOpen)
		this.isWebStoreOpen = await this.jeepSqliteElement.isStoreOpen();
		*/
		throw new Error("WebStore is not open yet. You have to call \"initWebStore()\" first.");
	}
	async getUrl() {
		throw this.unimplemented("Not implemented on web.");
	}
	async getMigratableDbList(options) {
		console.log("getMigratableDbList", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async addSQLiteSuffix(options) {
		console.log("addSQLiteSuffix", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async deleteOldDatabases(options) {
		console.log("deleteOldDatabases", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async moveDatabasesAndAddSuffix(options) {
		console.log("moveDatabasesAndAddSuffix", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async isSecretStored() {
		throw this.unimplemented("Not implemented on web.");
	}
	async setEncryptionSecret(options) {
		console.log("setEncryptionSecret", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async changeEncryptionSecret(options) {
		console.log("changeEncryptionSecret", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async clearEncryptionSecret() {
		console.log("clearEncryptionSecret");
		throw this.unimplemented("Not implemented on web.");
	}
	async checkEncryptionSecret(options) {
		console.log("checkEncryptionPassPhrase", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async getNCDatabasePath(options) {
		console.log("getNCDatabasePath", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async createNCConnection(options) {
		console.log("createNCConnection", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async closeNCConnection(options) {
		console.log("closeNCConnection", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async isNCDatabase(options) {
		console.log("isNCDatabase", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async isDatabaseEncrypted(options) {
		console.log("isDatabaseEncrypted", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async isInConfigEncryption() {
		throw this.unimplemented("Not implemented on web.");
	}
	async isInConfigBiometricAuth() {
		throw this.unimplemented("Not implemented on web.");
	}
	async loadExtension(options) {
		console.log("loadExtension", options);
		throw this.unimplemented("Not implemented on web.");
	}
	async enableLoadExtension(options) {
		console.log("enableLoadExtension", options);
		throw this.unimplemented("Not implemented on web.");
	}
};
//#endregion
export { CapacitorSQLiteWeb };
