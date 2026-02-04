import type { Handler } from '@netlify/functions';
import { jsonResponse } from './utils/response';

export const handler: Handler = async () => {
  return jsonResponse(200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};
