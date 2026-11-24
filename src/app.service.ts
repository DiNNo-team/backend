import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HealthStatus {
  status: 'ok';
  // Deployed commit: GIT_COMMIT (set by the Azure pipeline) or, if it is not
  // set, RENDER_GIT_COMMIT (set by Render); null where neither is set, such as
  // local runs. CI compares it with the pushed commit.
  commit: string | null;
}

const COMMIT_VARIABLES = ['GIT_COMMIT', 'RENDER_GIT_COMMIT'] as const;

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  getHealth(): HealthStatus {
    const commit = COMMIT_VARIABLES.map((name) =>
      this.config.get<string>(name)?.trim(),
    ).find(Boolean);
    return { status: 'ok', commit: commit ?? null };
  }
}
