const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.notifyParentOnFirstAttendance = onDocumentCreated(
  "attendance/{attendanceId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();
    if (!data?.organizationId || !data?.date || !data?.classCode) return;

    const allAttendance = await db
      .collection("attendance")
      .where("organizationId", "==", data.organizationId)
      .where("date", "==", data.date)
      .where("classCode", "==", data.classCode)
      .get();

    const hasEarlierRecord = allAttendance.docs.some(
      (item) => item.id !== snapshot.id
    );

    if (hasEarlierRecord) return;

    const studentRecords = Array.isArray(data.records) ? data.records : [];
    const studentsSnapshot = await db
      .collection("students")
      .where("organizationId", "==", data.organizationId)
      .where("classCode", "==", data.classCode)
      .get();

    const studentsByNo = new Map(
      studentsSnapshot.docs.map((student) => [
        String(student.data().studentNo || ""),
        student,
      ])
    );

    const relationshipsSnapshot = await db
      .collection("parentStudents")
      .where("organizationId", "==", data.organizationId)
      .where("active", "==", true)
      .get();

    const relationshipsByStudent = new Map();

    for (const relation of relationshipsSnapshot.docs) {
      const relationData = relation.data();
      const studentId = String(relationData.studentId || "");
      const parentUid = String(relationData.parentUid || "");
      if (!studentId || !parentUid) continue;

      const list = relationshipsByStudent.get(studentId) || [];
      list.push(parentUid);
      relationshipsByStudent.set(studentId, list);
    }

    const writes = [];

    for (const record of studentRecords) {
      const student = studentsByNo.get(String(record.studentNo || ""));
      if (!student) continue;

      const studentId = student.id;
      const parentUids = relationshipsByStudent.get(studentId) || [];
      if (!parentUids.length) continue;

      const status = String(record.status || "unknown");
      const statusText =
        status === "present"
          ? "mevcut"
          : status === "absent"
            ? "devamsız"
            : status === "late"
              ? "geç"
              : "bilinmiyor";

      for (const parentUid of parentUids) {
        const notificationId =
          snapshot.id + "__" + studentId + "__" + parentUid;

        writes.push({
          ref: db.collection("notifications").doc(notificationId),
          data: {
            organizationId: data.organizationId,
            recipientUid: parentUid,
            studentId,
            attendanceId: snapshot.id,
            type: "first_attendance",
            title: "İlk Yoklama Sonucu",
            message:
              "Öğrenciniz ilk yoklamada " +
              statusText +
              " olarak kaydedildi.",
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          },
        });
      }
    }

    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const item of writes.slice(i, i + 400)) {
        batch.set(item.ref, item.data, { merge: true });
      }
      await batch.commit();
    }
  }
);
