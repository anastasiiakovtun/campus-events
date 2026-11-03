import * as statsService from '../services/statsService.mjs';

// GET /api/stats → how full every event is (occupancy + status)
export async function show(req, res) {
  res.json(await statsService.getStats());
}