# What does mongoBackup do?
Backup mongodb and transfer the backup data to a remote server every sunday at 1am.
# How to install?
1. Clone the repo and then run:
```bash
cd /path/to/mongoBackup
npm install
```
2. Use pm2 to run the script and save it to run after reboots and at startup.
