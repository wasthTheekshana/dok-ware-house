export type UserRole = 'system_admin' | 'warehouse_admin' | 'finance_officer';

export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses'
    | 'manage_staff'
    | 'manage_payroll';

export interface WhUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: UserRole;
    STATUS: 'active' | 'inactive';
    WAREHOUSE_IDS: number[];
    EFFECTIVE_PERMISSIONS: PermissionKey[];
}

export interface LoginResponse {
    token: string;
    user: WhUser;
}

export interface AppUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: UserRole;
    STATUS: 'active' | 'inactive';
    WAREHOUSE_IDS: number[];
    CREATED_AT: string;
    PERMISSION_OVERRIDES?: { PERMISSION_KEY: PermissionKey; GRANTED: boolean }[];
}

export interface Company {
    ID: number;
    NAME: string;
    CODE: string | null;
    CONTACT_PERSON: string | null;
    PHONE: string | null;
    EMAIL: string | null;
    ADDRESS: string | null;
    STATUS: 'active' | 'inactive';
    DEPARTMENT_COUNT?: number;
    TOTAL_BOX_COUNT?: number;
    DEPARTMENTS?: Department[];
}

export interface Warehouse {
    ID: number;
    NAME: string;
    CODE: string | null;
    ADDRESS: string | null;
    STATUS: 'active' | 'inactive';
    DEPARTMENT_COUNT?: number;
    DEPARTMENTS?: {
        ID: number;
        NAME: string;
        CODE: string | null;
        STATUS: 'active' | 'inactive';
        CURRENT_BOX_COUNT: number;
        COMPANY_ID: number;
        COMPANY_NAME: string;
    }[];
}

export interface Department {
    ID: number;
    COMPANY_ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    NAME: string;
    CODE: string | null;
    STATUS: 'active' | 'inactive';
    CURRENT_BOX_COUNT: number;
    PRICE_PER_ARCHIVED_BOX: number;
    PRICE_PER_RETRIEVED_BOX: number;
    PRICE_PER_EMPTY_CARTON: number;
    PRICE_PER_BOX_STORED_MONTHLY: number;
}

export interface InvoiceBreakdown {
    DEPARTMENT_ID: number;
    COMPANY_ID: number;
    DEPARTMENT_NAME: string;
    COMPANY_NAME: string;
    PERIOD_FROM: string;
    PERIOD_TO: string;
    ARCHIVED_COUNT: number;
    RETRIEVED_COUNT: number;
    EMPTY_CARTON_COUNT: number;
    PRICE_PER_ARCHIVED_BOX: number;
    PRICE_PER_RETRIEVED_BOX: number;
    PRICE_PER_EMPTY_CARTON: number;
    BOX_COUNT_AT_BILLING: number;
    STORAGE_RENTAL_AMOUNT: number;
    SUBTOTAL: number;
    SSCL_AMOUNT: number;
    VAT_AMOUNT: number;
    TOTAL_AMOUNT: number;
}

export interface Invoice extends InvoiceBreakdown {
    ID: number;
    CREATED_AT: string;
    CREATED_BY: number | null;
    REVERSES_INVOICE_ID: number | null;
}

export type BoxEventType = 'archived' | 'retrieved' | 'empty_carton_issued' | 'disposed';

export interface BoxEvent {
    ID: number;
    DEPARTMENT_ID: number;
    DEPARTMENT_NAME?: string;
    COMPANY_NAME?: string;
    EVENT_TYPE: BoxEventType;
    QUANTITY: number;
    EVENT_DATE: string;
    REFERENCE_NO: string | null;
    REMARKS: string | null;
    CREATED_AT: string;
}

export interface CompanySummaryRow {
    COMPANY_ID: number;
    COMPANY_NAME: string;
    TOTAL_BOX_COUNT: number;
}

export interface MonthlySummaryRow {
    MONTH: string;
    ARCHIVED: number;
    RETRIEVED: number;
    EMPTY_CARTON_ISSUED: number;
}

export interface WarehouseExpense {
    ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    EXPENSE_DATE: string;
    TRANSPORT_AMOUNT: number;
    FUEL_AMOUNT: number;
    LABOUR_AMOUNT: number;
    MEALS_AMOUNT: number;
    OTHER_AMOUNT: number;
    REMARKS: string | null;
    CREATED_AT: string;
    UPDATED_AT: string;
}

export interface ExpenseCategorySummary {
    current: number;
    variance: { value: number | null; percent: number | null };
}

export interface ExpenseSummary {
    warehouse_id: number;
    year: number;
    month: number;
    categories: {
        transport_amount: ExpenseCategorySummary;
        fuel_amount: ExpenseCategorySummary;
        labour_amount: ExpenseCategorySummary;
        meals_amount: ExpenseCategorySummary;
        other_amount: ExpenseCategorySummary;
    };
}

export interface ExpenseComparisonRow {
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME: string;
    TOTAL_AMOUNT: number;
}

export interface Staff {
    ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    NAME: string;
    NIC: string;
    DESIGNATION: string | null;
    JOIN_DATE: string;
    BASIC_SALARY: number;
    EPF_NO: string | null;
    STATUS: 'active' | 'inactive';
    CREATED_AT: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';

export interface AttendanceEntry {
    ID: number;
    STAFF_ID: number;
    STAFF_NAME?: string;
    WAREHOUSE_ID?: number;
    ATTENDANCE_DATE: string;
    STATUS: AttendanceStatus;
    IN_TIME: string | null;
    OUT_TIME: string | null;
}

export interface AttendanceSummary {
    staff_id: number;
    year: number;
    month: number;
    counts: {
        present: number;
        absent: number;
        half_day: number;
        leave: number;
    };
}

export type PayrollStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface Payroll {
    ID: number;
    STAFF_ID: number;
    STAFF_NAME?: string;
    WAREHOUSE_ID: number;
    MONTH: number;
    YEAR: number;
    BASIC_PAY: number;
    OT_AMOUNT: number;
    DEDUCTIONS: number;
    EPF_EMPLOYEE: number;
    EPF_EMPLOYER: number;
    ETF: number;
    NET_SALARY: number;
    STATUS: PayrollStatus;
    REVERSES_PAYROLL_ID: number | null;
    CREATED_BY: number | null;
    APPROVED_BY: number | null;
    CREATED_AT: string;
    UPDATED_AT: string;
}

export interface PayrollReportRow {
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME: string;
    TOTAL_NET_SALARY: number;
    TOTAL_EMPLOYER_COST: number;
}
