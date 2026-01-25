import { openDB } from 'idb';

const DB_NAME = 'marka-db';
const STORE_NAME = 'projects';

export const initDB = async () => {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        },
    });
};

export const saveProjectData = async (projectId, data) => {
    const db = await initDB();
    await db.put(STORE_NAME, { id: projectId, ...data, updatedAt: Date.now() });
};

export const loadProjectData = async (projectId) => {
    const db = await initDB();
    return await db.get(STORE_NAME, projectId);
};
