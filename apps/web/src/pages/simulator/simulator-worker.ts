/** Web Worker des Simulators S-40 (AP-13f): rechnet `simulate` abseits des UI-Threads. */
import { expose } from '../../lib/worker-rpc';
import { simulate } from './simulate';

export const simulatorApi = { simulate };
export type SimulatorApi = typeof simulatorApi;

expose(simulatorApi);
