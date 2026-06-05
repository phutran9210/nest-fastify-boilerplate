export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ResponseMeta = {
  timestamp: string;
  path: string;
  requestId: string;
  pagination?: PaginationMeta;
};

export type SuccessResponse<T> = {
  success: true;
  data: T;
  meta: ResponseMeta;
};

export type ErrorDetail = {
  field: string;
  message: string;
};

export type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  meta: ResponseMeta;
};
