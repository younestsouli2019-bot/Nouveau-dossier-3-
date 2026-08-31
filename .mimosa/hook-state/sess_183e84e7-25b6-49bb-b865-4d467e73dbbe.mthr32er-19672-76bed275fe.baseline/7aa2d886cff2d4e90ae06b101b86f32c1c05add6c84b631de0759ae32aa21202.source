
import cron from 'node-cron';
import { exec } from 'child_process';

// Schedule PayPal approval script to run every hour
cron.schedule('0 * * * *', () => {
    console.log('Running PayPal approval script...');
    exec('node scripts/approve-paypal.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing approve-paypal.js: ${error}`);
            return;
        }
        console.log(`approve-paypal.js output: ${stdout}`);
        console.error(`approve-paypal.js errors: ${stderr}`);
    });
});

// Schedule Crypto approval script to run every hour
cron.schedule('0 * * * *', () => {
    console.log('Running Crypto approval script...');
    exec('node scripts/approve-crypto.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing approve-crypto.js: ${error}`);
            return;
        }
        console.log(`approve-crypto.js output: ${stdout}`);
        console.error(`approve-crypto.js errors: ${stderr}`);
    });
});

// Schedule Bank Wire approval script to run every hour
cron.schedule('0 * * * *', () => {
    console.log('Running Bank Wire approval script...');
    exec('node scripts/approve-bankwire.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing approve-bankwire.js: ${error}`);
            return;
        }
        console.log(`approve-bankwire.js output: ${stdout}`);
        console.error(`approve-bankwire.js errors: ${stderr}`);
    });
});

console.log('Scheduled tasks for payment approvals have been set up.');
