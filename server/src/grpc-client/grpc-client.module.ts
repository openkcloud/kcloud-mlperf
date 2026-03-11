import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { _PACKAGE_NAME } from '../../proto-types/exam';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: process.env.GRPC_CLIENT_NAME || 'EXAM_PACKAGE',
        transport: Transport.GRPC,
        options: {
          url: `${process.env.GRPC_IP}`,
          package: _PACKAGE_NAME,
          protoPath: join(__dirname, '../../proto/exam.proto'),
        },
      },
    ]),
  ],
  exports: [ClientsModule], // export so other modules can use it
})
export class GrpcClientModule {}
