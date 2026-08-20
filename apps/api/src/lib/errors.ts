import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found', requestId: req.requestId } });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;
  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'The request body is too large', requestId: req.requestId } });
    return;
  }
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields', fieldErrors: flattened.fieldErrors, requestId: req.requestId } });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } });
    return;
  }
  req.log?.error({ err: error, requestId: req.requestId }, 'unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: req.requestId } });
};

export function asyncRoute(handler: (...args: any[]) => Promise<unknown>): RequestHandler {
  return (req, res, next) => void Promise.resolve(handler(req, res, next)).catch(next);
}
