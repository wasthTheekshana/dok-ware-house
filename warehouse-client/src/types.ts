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
