import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { __resetWeather, getWeatherState, rememberLocation, refreshWeather, disableWeather } from '@/features/weather/store';
import { DayForecast, WeatherCard } from '@/features/weather/WeatherCard';

const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hourIso = `${today}T${pad(now.getHours())}:00`;

const response = {
  latitude: -34.6,
  longitude: -58.38,
  timezone: 'America/Argentina/Buenos_Aires',
  current: { time: hourIso, temperature_2m: 22.4, apparent_temperature: 23, weather_code: 63, wind_speed_10m: 12, is_day: 1 },
  hourly: {
    time: Array.from({ length: 12 }, (_, i) => `${today}T${pad((now.getHours() + i) % 24)}:00`),
    temperature_2m: Array(12).fill(22),
    weather_code: Array(12).fill(63),
    precipitation_probability: Array(12).fill(80),
    wind_speed_10m: Array(12).fill(12),
  },
  daily: { time: [today], weather_code: [63], temperature_2m_max: [25], temperature_2m_min: [17], precipitation_probability_max: [85], wind_speed_10m_max: [20], uv_index_max: [5] },
};

beforeEach(() => {
  localStorage.clear();
  __resetWeather();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('clima', () => {
  it('sin ubicación invita a activarlo', () => {
    render(<WeatherCard />);
    expect(screen.getByRole('button', { name: /activar/i })).toBeTruthy();
  });

  it('con ubicación muestra el pronóstico y consejos según la actividad, y lo guarda para usar sin internet', async () => {
    await act(async () => {
      rememberLocation(-34.6037, -58.3816);
      await refreshWeather(true);
    });
    expect(getWeatherState().coords).toEqual({ lat: -34.6, lon: -58.38 });
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toContain('latitude=-34.6&longitude=-58.38');

    render(<WeatherCard activity="bike" />);
    expect(screen.getAllByText('22°').length).toBeGreaterThan(0);
    expect(screen.getByText('Lluvia')).toBeTruthy();
    expect(screen.getByText(/piso mojado/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('fit20:wx-forecast')!).now.temp).toBe(22.4);
    cleanup();

    render(<WeatherCard activity="strength" />);
    expect(screen.queryByText(/piso mojado/)).toBeNull(); // fuerza es bajo techo
    cleanup();

    render(<DayForecast date={today} activity="run" />);
    expect(screen.getByText(/85% lluvia/)).toBeTruthy();
    expect(screen.getByText(/cinta/)).toBeTruthy();
  });

  it('no vuelve a descargar si el pronóstico es reciente, y se puede olvidar la ubicación', async () => {
    await act(async () => {
      rememberLocation(-34.6, -58.38);
      await refreshWeather(true);
      await refreshWeather();
    });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    act(() => disableWeather());
    expect(localStorage.getItem('fit20:wx-loc')).toBeNull();
    expect(getWeatherState().status).toBe('off');
  });
});
