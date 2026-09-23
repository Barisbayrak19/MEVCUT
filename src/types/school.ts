export interface EOkulClassImport {
  code: string;
  name: string;
}

export interface EOkulStudentImport {
  studentNo: string;
  name: string;
  tcNo: string;
  classCode: string;
  className: string;
}

export interface EOkulImportPayload {
  organizationId: string;
  periodCode: string;
  institutionCode: string;
  importedAt: string;
  classes: EOkulClassImport[];
  students: EOkulStudentImport[];
}
