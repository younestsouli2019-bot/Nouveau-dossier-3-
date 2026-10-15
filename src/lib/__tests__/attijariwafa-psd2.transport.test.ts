import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
	vi.resetModules();
	return await import('../attijariwafa-psd2');
}

function jsonResponse(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => 'application/json' },
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

beforeEach(() => {
	process.env.LIVE_BANK_API = 'test-bearer-token';
	delete process.env.ATTIJARI_CLIENT_ID;
	delete process.env.ATTIJARI_CLIENT_SECRET;
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	vi.restoreAllMocks();
});

describe('psd2Request transport honesty (Layer 0)', () => {
	it('throws Psd2Error 503 when neither bearer nor OAuth is configured', async () => {
		process.env.LIVE_BANK_API = '';
		const { initiatePayment, Psd2Error } = await loadModule();
		await expect(
			initiatePayment({
				creditorIban: 'MA64011515040001234567890123',
				creditorName: 'Owner',
				amount: '1.00',
				currency: 'MAD',
				reference: 'T-1',
			}),
		).rejects.toBeInstanceOf(Psd2Error);
	});

	it('throws Psd2Error httpStatus 0 on transport failure', async () => {
		const { initiatePayment, Psd2Error } = await loadModule();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('ECONNREFUSED');
			}),
		);
		const err = await initiatePayment({
			creditorIban: 'MA64011515040001234567890123',
			creditorName: 'Owner',
			amount: '1.00',
			currency: 'MAD',
			reference: 'T-2',
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Psd2Error);
		expect(err.httpStatus).toBe(0);
		expect(err.message).toContain('transport failure');
	});

	it('surfaces the STET error body on 403 instead of returning an empty paymentId', async () => {
		const { initiatePayment, Psd2Error } = await loadModule();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse(403, {
					code: 'CERTIFICATE_INVALID',
					message: 'The provided eIDAS certificate is invalid or missing required PISP roles.',
					status: 403,
				}),
			),
		);
		const err = await initiatePayment({
			creditorIban: 'MA64011515040001234567890123',
			creditorName: 'Owner',
			amount: '1.00',
			currency: 'MAD',
			reference: 'T-3',
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Psd2Error);
		expect(err.httpStatus).toBe(403);
		expect(err.body).toMatchObject({ code: 'CERTIFICATE_INVALID' });
	});

	it('returns the real paymentId on a genuine 2xx', async () => {
		const { initiatePayment } = await loadModule();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse(200, { paymentId: 'PSP-9F2A11', status: 'ACSC' }),
			),
		);
		const payment = await initiatePayment({
			creditorIban: 'MA64011515040001234567890123',
			creditorName: 'Owner',
			amount: '1.00',
			currency: 'MAD',
			reference: 'T-4',
		});
		expect(payment.paymentId).toBe('PSP-9F2A11');
		expect(payment.status).toBe('ACSC');
	});

	it('throws rather than fabricating pending on a 2xx with no status', async () => {
		const { initiatePayment, Psd2Error } = await loadModule();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(200, { paymentId: 'PSP-9F2A11' })),
		);
		const err = await initiatePayment({
			creditorIban: 'MA64011515040001234567890123',
			creditorName: 'Owner',
			amount: '1.00',
			currency: 'MAD',
			reference: 'T-5',
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Psd2Error);
		expect(err.message).toContain('no status field');
	});
});
