import multer from "multer";
import fs from "fs";
import path from "path";

// Ensure uploads folder exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Only safe image/PDF types (blocks .html/.exe/.svg-etc. uploads). PDFs are
// allowed for KYC documents; they are never served by the public /uploads
// mount (which only permits image extensions).
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_UPLOAD_TYPES.has(file.mimetype)) {
    return cb(null, true);
  }
  const err = new Error(
    `Unsupported file type: ${file.mimetype}. Only images and PDF documents are allowed.`
  );
  err.status = 400;
  return cb(err, false);
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Use the ensured folder
  },

  filename: function (req, file, cb) {
    // Keep a safe extension derived from the validated MIME type
    const safeExts = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/avif": ".avif",
      "application/pdf": ".pdf",
    };
    const ext = safeExts[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per file
});