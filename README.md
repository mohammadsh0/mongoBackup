# What does mongoBackup do?
Backup mongodb and transfer the backup data to a remote storage at the cron-time syntax specified in the .env file.
# Limitations
- Currently only sftp protocol is supported
- Only full backups are supported for now
# How to install?
1. Clone the repo and then run:
```bash
cd /path/to/mongoBackup
npm install
```
2. open .env file in your editor of choice
3. Fill out fields according to the description in front of each item
4. Use pm2 to run the script and save it to run after reboots and at startup.
5. run the following commands to run at startup
```bash
pm2 start dist/index.js
pm2 startup
pm2 save
```
# Future development
- Backup databases partially
- Restore backups
- Compatibility with other protocols for transferring backups
