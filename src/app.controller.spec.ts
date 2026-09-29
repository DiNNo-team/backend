import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { parseCorsOrigins } from './app.setup.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return status ok', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
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
