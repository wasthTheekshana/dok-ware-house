// Ensures a JWT_SECRET is present for tests run without an explicit env var
// (authUtils.ts throws at module load time if JWT_SECRET is unset).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
