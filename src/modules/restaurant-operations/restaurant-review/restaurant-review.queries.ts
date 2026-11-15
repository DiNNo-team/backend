import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsOrder } from 'typeorm';
import { Repository } from 'typeorm';
import {
  PENDING,
  UsersService,
  type RestaurantApprovalStatus,
} from '../../identity-access/index.js';
import { restaurantNotFound } from '../shared/restaurant-not-found.js';
import { RestaurantSchedule } from '../restaurants/restaurant-schedule.entity.js';
import { Restaurant } from '../restaurants/restaurant.entity.js';
import {
  AdminRestaurantDetailDto,
  AdminRestaurantItemDto,
  type AdminRestaurantPageDto,
} from './dto/admin-restaurant-response.dto.js';

export interface AdminRestaurantsPage {
  status: RestaurantApprovalStatus;
  page: number;
  pageSize: number;
}

// Orden de la lista: las pendientes, la que más lleva esperando primero; las
// revisadas, la última revisión primero (las aprobadas sin revisión, por la
// migración o por el equipo, al final). id desempata siempre.
export function adminListOrder(
  status: RestaurantApprovalStatus,
): FindOptionsOrder<Restaurant> {
  return status === PENDING
    ? { submittedAt: 'ASC', id: 'ASC' }
    : {
        reviewedAt: { direction: 'DESC', nulls: 'LAST' },
        submittedAt: 'DESC',
        id: 'ASC',
      };
}

// Lecturas del panel del administrador de DiNNo (§11, "Administrador"). Los
// correos salen de UsersService en una consulta por lista: nunca N+1.
@Injectable()
export class RestaurantReviewQueries {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(RestaurantSchedule)
    private readonly schedules: Repository<RestaurantSchedule>,
    private readonly users: UsersService,
  ) {}

  async list({
    status,
    page,
    pageSize,
  }: AdminRestaurantsPage): Promise<AdminRestaurantPageDto> {
    const [rows, total] = await this.restaurants.findAndCount({
      where: { approvalStatus: status },
      order: adminListOrder(status),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const owners = await this.users.findRestaurantOwnerEmails(
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) =>
        AdminRestaurantItemDto.fromEntity(row, owners.get(row.id) ?? null),
      ),
      total,
      page,
      pageSize,
    };
  }

  // 404 RESTAURANT_NOT_FOUND si no existe (el id ya llega validado como UUID).
  async detail(id: string): Promise<AdminRestaurantDetailDto> {
    const restaurant = await this.restaurants.findOneBy({ id });
    if (!restaurant) {
      throw restaurantNotFound();
    }
    const [schedules, owners, reviewers] = await Promise.all([
      this.schedules.find({
        where: { restaurantId: id },
        order: { dayOfWeek: 'ASC' },
      }),
      this.users.findRestaurantOwnerEmails([id]),
      this.users.findPlatformAdminEmailsByIds(
        restaurant.reviewedBy ? [restaurant.reviewedBy] : [],
      ),
    ]);
    return AdminRestaurantDetailDto.fromParts(restaurant, schedules, {
      ownerEmail: owners.get(id) ?? null,
      reviewedByEmail: restaurant.reviewedBy
        ? (reviewers.get(restaurant.reviewedBy) ?? null)
        : null,
    });
  }
}
