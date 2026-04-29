import { Controller, Get } from '@nestjs/common';
import { DeviceRegistryService } from './device-registry.service';

@Controller('devices')
export class DeviceRegistryController {
  constructor(private readonly registry: DeviceRegistryService) {}

  @Get()
  async getDevices() {
    return this.registry.getDevices();
  }

  @Get('nodes')
  async getNodes() {
    return this.registry.getNodes();
  }

  @Get('health')
  async getHealth() {
    return this.registry.getHealth();
  }
}
