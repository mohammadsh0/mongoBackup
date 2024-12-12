import 'dotenv/config'
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { MongoClient } from 'mongodb';
import SftpClient from 'ssh2-sftp-client';
import cron from 'node-cron';

interface Connection {
  host: string | undefined;
  port: string | undefined;
  user: string | undefined;
  pass: string | undefined;
}

interface Databases {
  [key: string]: string[];
}

interface RemoteTransfer extends Connection {
  dest: string | any;
}

const mongoConnection: Connection = {
  host: process.env.mongoHost,
  port: process.env.mongoPort,
  user: process.env.mongoUser,
  pass: process.env.mongoPassword,
};
const remoteConnection: RemoteTransfer = {
  host: process.env.remoteHost,
  port: process.env.remotePort,
  user: process.env.remoteUser,
  pass: process.env.remotePassword,
  dest: process.env.remoteBackupFolder,
};
const backupFolder: string | undefined = process.env.localBackupFolder;
const timeZone: string | undefined = process.env.timeZone;
const cronTime = process.env.cronTime;

class MongoBackupTransfer {
  mongoUser: string | undefined;
  mongoPassword: string | undefined;
  mongoHost: string | undefined;
  mongoPort: string | undefined;
  client: any;
  backupDir: string;
  databases: Databases;
  constructor(connection: Connection) {
    this.mongoHost = connection.host;
    this.mongoPort = connection.port;
    this.mongoUser = connection.user;
    this.mongoPassword = connection.pass;
    this.backupDir = '';
    this.client = new MongoClient(
      `mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}`
    );
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
      if (!this.databases[dbName]) this.databases[dbName] = [];
      for (let i = 0; i < collections.length; i++) {
        let collectionName = collections[i].name;
        this.databases[dbName].push(collectionName);
      }
    }
  }

  // calls dateAndTimeForFolderName & mkdirIfNotExists to cleanup and create new directory
  makeBackupDir(rootBackupFolder: string | undefined) {
    const [date, time] = this.#dateAndTimeForFolderName();
    const newBackupDirName = `mongodb-${date}_${time}`;
    if (typeof rootBackupFolder === 'undefined') {
      throw new Error("Specified backup folder doesn't exist");
    }
    this.backupDir = path.join(rootBackupFolder, newBackupDirName);

    if (fs.existsSync(this.backupDir)) {
      fs.rmSync(this.backupDir, {
        recursive: true,
      });
    }
    this.#mkdirIfNotExists(this.backupDir);
  }

  #dateAndTimeForFolderName() {
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
  }

  #mkdirIfNotExists(path: string) {
    let pathExists = fs.existsSync(path);
    if (!pathExists) {
      let newPath = fs.mkdirSync(path, {
        recursive: true,
      });
      console.log(`${newPath} created`);
    }
  }

  // For later use
  backupOneCollection(dbName: string, collectionName: string) {
    return new Promise((resolve, reject) => {
      let worker = child_process.spawn('mongodump', [
        '--uri',
        `mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}/?authSource=admin&readPreference=primary&directConnection=true&ssl=false`,
        `--db=${dbName}`,
        `--collection=${collectionName}`,
        '--out',
        `${this.backupDir}`,
        '--gzip',
      ]);
      worker.stdout.on('data', (data: Buffer) => {
        console.log(data.toString());
      });
      worker.stderr.on('data', (data: Buffer) => {
        reject(data.toString());
        console.log(data.toString());
      });
      worker.on('close', (code: number) => {
        // console.log;
        resolve('child process exited with code ' + code);
        console.log('child process exited with code ' + code);
      });
    });
  }

  backupAllCollections() {
    // mongodump mistakenly reports it's stdout on the stderr and because of this the normal way of writing this
    // isn't going to work.
    return new Promise((resolve: (value: string) => void, reject) => {
      let mongoDump = child_process.spawn('mongodump', [
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
      mongoDump.stderr.on('data', (data: Buffer) => {
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

  async transferBackup(remoteConnection: RemoteTransfer) {
    let src = this.backupDir;
    let dest = path.join(remoteConnection.dest, path.basename(src));
    let client = new SftpClient();
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
      client.on('upload', (info: any) => {
        console.log(`Uploaded ${info.source}`);
      });
      let result = await client.uploadDir(src, dest, { useFastput: true });
      return result;
    } catch (error) {
      console.error(error);
    } finally {
      client.end();
    }
  }

  closeConnection() {
    this.client.close();
    console.log('Connection with DB closed.');
  }
}

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
  throw new Error("Crontime not specified")
} else {
  if (!cron.validate(cronTime)) {
    throw new Error("Crontime isn't valid!")
  }
  cron.schedule(
    cronTime,
    () => {
      main();
    },
    {
      timezone: timeZone,
    }
  );
}
