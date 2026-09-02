export interface WhUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: 'admin' | 'staff';
    STATUS: 'active' | 'inactive';
}

export interface LoginResponse {
    token: string;
    user: WhUser;
}

export interface AppUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: 'admin' | 'staff';
    STATUS: 'active' | 'inactive';
    CREATED_AT: string;
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
    SUBTOTAL: number;
    SSCL_AMOUNT: number;
    VAT_AMOUNT: number;
    TOTAL_AMOUNT: number;
}

export interface Invoice extends InvoiceBreakdown {
    ID: number;
    CREATED_AT: string;
    CREATED_BY: number | null;
}

export type BoxEventType = 'archived' | 'retrieved' | 'empty_carton_issued';

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
