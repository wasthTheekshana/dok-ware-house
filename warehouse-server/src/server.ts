import { app } from './app';
import { initializeDb } from './db/config';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5100;

async function startServer() {
    await initializeDb();

    app.listen(PORT, () => {
        console.log(`Warehouse server running on port ${PORT}`);
    });
}

startServer();
