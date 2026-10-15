import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

// Errors of GET /v1/geocode (Sprint 2 contract). Single source of the codes and
// texts: the web branches on the code and, in both cases, shows the map
// centered on Bogotá so the user moves the pin.
export const GEOCODING_ERROR_MESSAGES = {
  ADDRESS_NOT_FOUND:
    'No encontramos esa dirección en Bogotá. Mueve el pin al lugar correcto.',
  GEOCODING_UNAVAILABLE:
    'No pudimos ubicar la dirección en este momento. Mueve el pin al lugar correcto.',
} as const;

export type GeocodingErrorCode = keyof typeof GEOCODING_ERROR_MESSAGES;

export function addressNotFound(): NotFoundException {
  return new NotFoundException(GEOCODING_ERROR_MESSAGES.ADDRESS_NOT_FOUND, {
    errorCode: 'ADDRESS_NOT_FOUND',
  });
}

export function geocodingUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    GEOCODING_ERROR_MESSAGES.GEOCODING_UNAVAILABLE,
    { errorCode: 'GEOCODING_UNAVAILABLE' },
  );
}
