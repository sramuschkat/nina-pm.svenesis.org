/**
 * Projekt und Rig für den Job `thumbnail` (AP-25) laden – mandantengebunden über die Repositories, das Rig
 * mit Teleskop und Kamera, damit das Bildfeld (`derived.fovWidthDeg/fovHeightDeg`) berechnet ist.
 */
import { EquipmentRepository, ProjectRepository, type OpenDatabase } from '@nina-pm/db';
import { rigView } from '../routes/web-equipment';
import { projectView } from '../routes/web-projects';
import type { ThumbnailDeps } from './thumbnail';

export function thumbnailLoader(db: () => Promise<OpenDatabase['db']>): ThumbnailDeps['load'] {
  return async (tenantId, projectId) => {
    const database = await db();
    const d = await new ProjectRepository(database, { tenantId }).detail(projectId);
    if (!d) return null;
    const project = projectView(d);
    if (project.rigId === null) return null;
    const equipment = new EquipmentRepository(database, { tenantId });
    const rig = await equipment.rig(project.rigId);
    if (!rig) return null;
    const [telescope, camera] = await Promise.all([
      equipment.telescope(rig.telescopeId),
      equipment.camera(rig.cameraId),
    ]);
    return { project, rig: rigView(rig, telescope, camera) };
  };
}
