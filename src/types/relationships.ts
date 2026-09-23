export interface ParentStudentRelationship {
  id: string;
  organizationId: string;
  parentUid: string;
  studentId: string;
  relationship: "parent" | "guardian";
  active: boolean;
}

export interface TeacherAssignmentAccess {
  id: string;
  organizationId: string;
  teacherUid: string;
  classCode: string;
  subjectCode: string;
  active: boolean;
}
