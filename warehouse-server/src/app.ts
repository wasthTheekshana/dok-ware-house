import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import companyRoutes from './routes/companyRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import userRoutes from './routes/userRoutes';
import departmentRoutes from './routes/departmentRoutes';
import boxEventRoutes from './routes/boxEventRoutes';
import summaryRoutes from './routes/summaryRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import expenseRoutes from './routes/expenseRoutes';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/box-events', boxEventRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

app.use((req, res) => {
    res.status(404).json({ message: 'Route not found', path: req.url });
});

export { app };
