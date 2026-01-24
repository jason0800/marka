import { useEffect } from 'react';
import useAppStore from '../../stores/useAppStore';
import { saveProjectData, loadProjectData } from '../../services/db-service';

const PersistenceManager = ({ projectId = 'default' }) => {
    const {
        measurements,
        calibrationScales,
        pageUnits,
        addMeasurement, // We need bulk set or similar? For now simple load.
        setPageScale
    } = useAppStore();

    // Load on mount
    useEffect(() => {
        const load = async () => {
            try {
                const data = await loadProjectData(projectId);
                if (data) {
                    // We need actions to set state in bulk.
                    // For MVP, we iterate or rely on a "setAll" action we need to add.
                    console.log("Loaded data:", data);
                    // Implementation requires store support for hydration
                }
            } catch (e) {
                console.error("Failed to load project", e);
            }
        };
        load();
    }, [projectId]);

    // Save on change
    useEffect(() => {
        const save = async () => {
            await saveProjectData(projectId, {
                measurements,
                calibrationScales,
                pageUnits
            });
        };

        const timeout = setTimeout(save, 1000); // Debounce
        return () => clearTimeout(timeout);
    }, [measurements, calibrationScales, pageUnits, projectId]);

    return null;
};

export default PersistenceManager;
