import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { logger } from '../lib/logger';

const PROTO_PATH = path.resolve(__dirname, '../proto/execution.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const grpcObject = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  livefxhub: {
    execution: {
      v1: {
        ExecutionService: grpc.ServiceClientConstructor;
      };
    };
  };
};

export interface GetPortfolioRequest {
  user_id: string;
}

export interface GetPortfolioResponse {
  balance: number;
  used_margin: number;
  free_margin: number;
  leverage: number;
  currency: string;
}

let _client: grpc.Client | null = null;

function getClient(): grpc.Client {
  if (_client) return _client;

  const { ExecutionService } = grpcObject.livefxhub.execution.v1;

  // Use a sensible default if not set in environment
  const executionServiceUrl = process.env['EXECUTION_GRPC_ADDRESS'] || 'localhost:50051';

  _client = new ExecutionService(
    executionServiceUrl,
    grpc.credentials.createInsecure(),
    {
      // Keep the persistent HTTP/2 connection alive.
      // Prevents the OS from closing idle TCP connections after 60s.
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
      'grpc.keepalive_permit_without_calls': 1,
      // Limit max message sizes to prevent abuse
      'grpc.max_receive_message_length': 1 * 1024 * 1024,
      'grpc.max_send_message_length': 1 * 1024 * 1024,
    },
  );

  logger.info({ address: executionServiceUrl }, 'gRPC client connected to execution-service');
  return _client;
}

export function getPortfolioSummary(request: GetPortfolioRequest): Promise<GetPortfolioResponse> {
  return new Promise((resolve, reject) => {
    const client = getClient();
    const deadline = new Date(Date.now() + 3_000);

    (client as unknown as {
      GetPortfolio: (
        req: GetPortfolioRequest,
        deadline: { deadline: Date },
        cb: (err: grpc.ServiceError | null, res: GetPortfolioResponse) => void,
      ) => void;
    }).GetPortfolio(request, { deadline }, (err, response) => {
      if (err) {
        logger.error({ grpcCode: err.code, details: err.details }, 'gRPC GetPortfolio failed');
        return reject(err);
      }
      resolve(response);
    });
  });
}

export function shutdownGrpcClient(): void {
  if (_client) {
    _client.close();
    _client = null;
    logger.info('gRPC client closed');
  }
}
