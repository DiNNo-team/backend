import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { parseCorsOrigins } from './app.setup.js';

describe('AppController', () => {
  async function controllerWith(
    env: Record<string, string>,
  ): Promise<AppController> {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    return app.get<AppController>(AppController);
  }

  describe('health', () => {
    it('should return status ok and a null commit when RENDER_GIT_COMMIT is not set', async () => {
      const appController = await controllerWith({});

      expect(appController.getHealth()).toEqual({ status: 'ok', commit: null });
    });

    it('should return the deployed commit from RENDER_GIT_COMMIT', async () => {
      const appController = await controllerWith({
        RENDER_GIT_COMMIT: ' 2ad0fcd4b1e8c9a7f3d2e1b0c9a8f7e6d5c4b3a2 ',
      });

      expect(appController.getHealth()).toEqual({
        status: 'ok',
        commit: '2ad0fcd4b1e8c9a7f3d2e1b0c9a8f7e6d5c4b3a2',
      });
    });

    it('should treat an empty RENDER_GIT_COMMIT as not set', async () => {
      const appController = await controllerWith({ RENDER_GIT_COMMIT: '' });

      expect(appController.getHealth().commit).toBeNull();
    });

    it('should return the deployed commit from GIT_COMMIT (Azure)', async () => {
      const appController = await controllerWith({ GIT_COMMIT: ' 2ad0fcd ' });

      expect(appController.getHealth().commit).toBe('2ad0fcd');
    });

    it('should prefer GIT_COMMIT over RENDER_GIT_COMMIT', async () => {
      const appController = await controllerWith({
        GIT_COMMIT: '2ad0fcd',
        RENDER_GIT_COMMIT: '9f8e7d6c5b4a3928170f6e5d4c3b2a1908f7e6d5',
      });

      expect(appController.getHealth().commit).toBe('2ad0fcd');
    });

    it('should fall back to RENDER_GIT_COMMIT when GIT_COMMIT is empty', async () => {
      const appController = await controllerWith({
        GIT_COMMIT: '  ',
        RENDER_GIT_COMMIT: '9f8e7d6c5b4a3928170f6e5d4c3b2a1908f7e6d5',
      });

      expect(appController.getHealth().commit).toBe(
        '9f8e7d6c5b4a3928170f6e5d4c3b2a1908f7e6d5',
      );
    });
  });
});

describe('parseCorsOrigins', () => {
  it('should default to the local web dashboard', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['http://localhost:5173']);
  });

  it('should split, trim and drop trailing slashes', () => {
    expect(
      parseCorsOrigins(' http://localhost:5173 , https://dinno.vercel.app/ ,'),
    ).toEqual(['http://localhost:5173', 'https://dinno.vercel.app']);
  });
});
