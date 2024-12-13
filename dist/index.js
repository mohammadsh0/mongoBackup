"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _MongoBackupTransfer_instances, _MongoBackupTransfer_dateAndTimeForFolderName, _MongoBackupTransfer_mkdirIfNotExists;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = __importDefault(require("child_process"));
const mongodb_1 = require("mongodb");
const ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
const node_cron_1 = __importDefault(require("node-cron"));
const mongoConnection = {
    host: process.env.mongoHost,
    port: process.env.mongoPort,
    user: process.env.mongoUser,
    pass: process.env.mongoPassword,
};
const remoteConnection = {
    host: process.env.remoteHost,
    port: process.env.remotePort,
    user: process.env.remoteUser,
    pass: process.env.remotePassword,
    dest: process.env.remoteBackupFolder,
};
const backupFolder = process.env.localBackupFolder;
const timeZone = process.env.timeZone;
const cronTime = process.env.cronTime;
class MongoBackupTransfer {
    constructor(connection) {
        _MongoBackupTransfer_instances.add(this);
        this.mongoHost = connection.host;
        this.mongoPort = connection.port;
        this.mongoUser = connection.user;
        this.mongoPassword = connection.pass;
        this.backupDir = '';
        this.client = new mongodb_1.MongoClient(`mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}/?authSource=admin&readPreference=primary&appname=MongoDB%20Compass&ssl=false`);
        this.databases = {};
    }
    // For later use
    async getCollections() {
        const admin = this.client.db().admin();
        const dbInfo = await admin.listDatabases();
        // Getting DB names
        for (let i = 0; i < dbInfo.databases.length; i++) {
            let dbName = dbInfo.databases[i].name;
            // Getting Collections of each DB
            const collections = await this.client
                .db(dbName)
                .listCollections()
                .toArray();
            if (!this.databases[dbName])
                this.databases[dbName] = [];
            for (let i = 0; i < collections.length; i++) {
                let collectionName = collections[i].name;
                this.databases[dbName].push(collectionName);
            }
        }
    }
    // calls dateAndTimeForFolderName & mkdirIfNotExists to cleanup and create new directory
    makeBackupDir(rootBackupFolder) {
        const [date, time] = __classPrivateFieldGet(this, _MongoBackupTransfer_instances, "m", _MongoBackupTransfer_dateAndTimeForFolderName).call(this);
        const newBackupDirName = `mongodb-${date}_${time}`;
        if (typeof rootBackupFolder === 'undefined') {
            throw new Error("Specified backup folder doesn't exist");
        }
        this.backupDir = path_1.default.join(rootBackupFolder, newBackupDirName);
        if (fs_1.default.existsSync(this.backupDir)) {
            fs_1.default.rmSync(this.backupDir, {
                recursive: true,
            });
        }
        __classPrivateFieldGet(this, _MongoBackupTransfer_instances, "m", _MongoBackupTransfer_mkdirIfNotExists).call(this, this.backupDir);
    }
    // For later use
    backupOneCollection(dbName, collectionName) {
        return new Promise((resolve, reject) => {
            let worker = child_process_1.default.spawn('mongodump', [
                '--uri',
                `mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}/?authSource=admin&readPreference=primary&directConnection=true&ssl=false`,
                `--db=${dbName}`,
                `--collection=${collectionName}`,
                '--out',
                `${this.backupDir}`,
                '--gzip',
            ]);
            worker.stdout.on('data', (data) => {
                console.log(data.toString());
            });
            worker.stderr.on('data', (data) => {
                reject(data.toString());
                console.log(data.toString());
            });
            worker.on('close', (code) => {
                // console.log;
                resolve('child process exited with code ' + code);
                console.log('child process exited with code ' + code);
            });
        });
    }
    backupAllCollections() {
        // mongodump mistakenly reports it's stdout on the stderr and because of this the normal way of writing this
        // isn't going to work.
        return new Promise((resolve, reject) => {
            let mongoDump = child_process_1.default.spawn('mongodump', [
                '--uri',
                `mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}/?authSource=admin&readPreference=primary`,
                '--out',
                `${this.backupDir}`,
                '--gzip',
            ]);
            // This does nothing because of mongodump bug reporting it's output on stderr
            // mongoDump.stdout.on('data', (data: Buffer) => {
            //   console.log(`This doesn't work: ${data}`);
            // });
            mongoDump.stderr.on('data', (data) => {
                // If uncommented, this reject statement f*** up resolving this promise.
                // This is due to the mongodump reporting it's output to stderr... and so
                // it causes the promise to never resolve!
                // reject(data.toString());
                console.log(data.toString());
            });
            mongoDump.stderr.on('end', () => {
                resolve('backup done');
            });
        });
    }
    async transferBackup(remoteConnection) {
        let src = this.backupDir;
        let dest = path_1.default.join(remoteConnection.dest, path_1.default.basename(src));
        let client = new ssh2_sftp_client_1.default();
        let config = {
            host: remoteConnection.host,
            username: remoteConnection.user,
            password: remoteConnection.pass,
            port: Number(remoteConnection.port),
        };
        try {
            await client.connect(config);
            let pathExistsinRemote = await client.exists(dest);
            if (!pathExistsinRemote) {
                await client.mkdir(dest, true);
            }
            client.on('upload', (info) => {
                console.log(`Uploaded ${info.source}`);
            });
            let result = await client.uploadDir(src, dest, { useFastput: true });
            return result;
        }
        catch (error) {
            console.error(error);
        }
        finally {
            client.end();
        }
    }
    closeConnection() {
        this.client.close();
        console.log('Connection with DB closed.');
    }
}
_MongoBackupTransfer_instances = new WeakSet(), _MongoBackupTransfer_dateAndTimeForFolderName = function _MongoBackupTransfer_dateAndTimeForFolderName() {
    // Getting current time and handling offset
    let now = new Date();
    const offset = now.getTimezoneOffset();
    let myNow = new Date(now.getTime() - offset * 60 * 1000);
    // Getting formatter date
    const currentDateAndTime = myNow.toISOString().split('T');
    const dateFormatted = currentDateAndTime[0];
    // Getting formatted time
    const time = myNow.toISOString().split('T')[1];
    const timeFormatted = time.slice(0, time.indexOf('.')).replaceAll(':', '-');
    return [dateFormatted, timeFormatted];
}, _MongoBackupTransfer_mkdirIfNotExists = function _MongoBackupTransfer_mkdirIfNotExists(path) {
    let pathExists = fs_1.default.existsSync(path);
    if (!pathExists) {
        let newPath = fs_1.default.mkdirSync(path, {
            recursive: true,
        });
        console.log(`${newPath} created`);
    }
};
const mongoBackup = new MongoBackupTransfer(mongoConnection);
function main() {
    mongoBackup.makeBackupDir(backupFolder);
    mongoBackup
        .backupAllCollections()
        .then((message) => {
        console.log(message);
        mongoBackup
            .transferBackup(remoteConnection)
            .then(() => {
            console.log('Backup transfer to remote completed');
            // Currently, there is no need for this connection. It's just implemented for later use
            // and probably will be moved to somewhere else in the code. Connection is closed here for cleanup purposes.
            mongoBackup.closeConnection();
        })
            .catch((err) => {
            console.log(err);
        });
    })
        .catch((err) => {
        console.log(err);
    });
}
// For testing
// main();
if (!cronTime) {
    throw new Error("Crontime not specified");
}
else {
    if (!node_cron_1.default.validate(cronTime)) {
        throw new Error("Crontime isn't valid!");
    }
    node_cron_1.default.schedule(cronTime, () => {
        main();
    }, {
        timezone: timeZone,
    });
}
