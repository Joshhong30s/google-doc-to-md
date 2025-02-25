import cloudinary from "cloudinary";

cloudinary.v2.config({
  cloud_name: "drozrybph",
  api_key: "***REMOVED***",
  api_secret: "***REMOVED***",
});

export async function uploadImageToCloudinary(imageUrl) {
  const result = await cloudinary.v2.uploader.upload(imageUrl);
  return result.secure_url;
}
