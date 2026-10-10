import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ctx } from '../context';
import { errorBody, HttpError } from '../errors';
import type { Logger } from '../logger';

/** Gives every request an id, returned as X-Request-Id and stored with its log row. */
export const requestId: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Request-Id', ctx(res).requestId);
  next();
};

export function notFound(): RequestHandler {
  return (req) => {
    throw new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`);
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const c = ctx(res);
    if (err instanceof HttpError) {
      c.errorCode = err.code;
      for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    // Errors raised by express.json() before our handlers run.
    if (err?.type === 'entity.parse.failed') {
      c.errorCode = 'invalid_json';
      res.status(400).json(errorBody('invalid_json', 'Request body is not valid JSON'));
      return;
    }
    if (err?.type === 'entity.too.large') {
      c.errorCode = 'payload_too_large';
      res.status(413).json(errorBody('payload_too_large', 'Request body is too large'));
      return;
    }
    logger.error({ err, requestId: c.requestId }, 'unhandled error');
    c.errorCode = 'internal_error';
    res
      .status(500)
      .json(
        errorBody('internal_error', 'Unexpected error; see gateway logs', {
          request_id: c.requestId,
        }),
      );
  };
}
