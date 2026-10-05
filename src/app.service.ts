import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HealthStatus {
  status: 'ok';
  // Deployed commit (Render sets RENDER_GIT_COMMIT); null where it is not set,
  // such as local runs. CI compares it with the pushed commit.
  commit: string | null;
}

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  getHealth(): HealthStatus {
    const commit = this.config.get<string>('RENDER_GIT_COMMIT')?.trim();
    return { status: 'ok', commit: commit || null };
  }
}
