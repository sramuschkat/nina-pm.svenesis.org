/** Web Worker für Saisondiagramm und Wochen-Sichtbarkeit (AP-24): nur Rechnung, kein Netz, kein DOM. */
import { seasonApi } from './season-api';
import { expose } from './worker-rpc';

expose(seasonApi);
