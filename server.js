// using express JS
var express = require("express");
var app = express();
require('dotenv').config()

// express formidable is used to parse the form data values
var formidable = require("express-formidable");
app.use(formidable());
// search
// const pdfjsLib = require('pdfjs-dist');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

const sharp = require("sharp");
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const mammoth = require('mammoth');
const multer = require('multer');
// const upload = multer({ dest: 'uploads/' });
// app.use(upload.single('file'));
// use mongo DB as database
var mongodb = require("mongodb");
var mongoClient = mongodb.MongoClient;

// the unique ID for each mongo DB document
var ObjectId = mongodb.ObjectId;

// receiving http requests
var httpObj = require("http");
var http = httpObj.createServer(app);

// to encrypt/decrypt passwords
var bcrypt = require("bcrypt");

// to store files
var fileSystem = require("fs");

// to start the session
var session = require("express-session");
app.use(session({
    secret: 'secret key',
    resave: false,
    saveUninitialized: false
}));
// search
app.use('/files', express.static('files'));
app.set('views', path.join(__dirname, "./views"))
// define the publically accessible folders
app.use("/public/css", express.static(__dirname + "/public/css"));
app.use("/public/js", express.static(__dirname + "/public/js"));
app.use("/public/img", express.static(__dirname + "/public/img"));
app.use("/public/font-awesome-4.7.0", express.static(__dirname + "/public/font-awesome-4.7.0"));
app.use("/public/fonts", express.static(__dirname + "/public/fonts"));

// using EJS as templating engine
app.set("view engine", "ejs");

// main URL of website
var mainURL = `http://${process.env.localhost}:${process.env.PORT}`;
console.log(process.env.PORT);

// global database object
var database = null;

// app middleware to attach main URL and user object with each request
app.use(function (request, result, next) {
    request.mainURL = mainURL;
    request.isLogin = (typeof request.session.user !== "undefined");
    request.user = request.session.user;

    // continue the request
    next();
});

// recursive function to get the file from uploaded
function recursiveGetFile(files, _id) {
    var singleFile = null;

    for (var a = 0; a < files.length; a++) {
        const file = files[a];

        // return if file type is not folder and ID is found
        if (file.type != "folder") {
            if (file._id == _id) {
                return file;
            }
        }

        // if it is a folder and have files, then do the recursion
        if (file.type == "folder" && file.files.length > 0) {
            singleFile = recursiveGetFile(file.files, _id);
            // return the file if found in sub-folders
            if (singleFile != null) {
                return singleFile;
            }
        }
    }
}

// function to add new uploaded object and return the updated array
function getUpdatedArray(arr, _id, uploadedObj) {
    for (var a = 0; a < arr.length; a++) {
        // push in files array if type is folder and ID is found
        if (arr[a].type == "folder") {
            if (arr[a]._id == _id) {
                arr[a].files.push(uploadedObj);
                arr[a]._id = ObjectId(arr[a]._id);
            }

            // if it has files, then do the recursion
            if (arr[a].files.length > 0) {
                arr[a]._id = ObjectId(arr[a]._id);
                getUpdatedArray(arr[a].files, _id, uploadedObj);
            }
        }
    }

    return arr;
}

// recursive function to remove the file and return the updated array
function removeFileReturnUpdated(arr, _id) {
    for (var a = 0; a < arr.length; a++) {
        if (arr[a].type != "folder" && arr[a]._id == _id) {
            // remove the file from uploads folder
            try {
                fileSystem.unlinkSync(arr[a].filePath);
            } catch (exp) {
                // 
            }
            // remove the file from array
            arr.splice(a, 1);
            break;
        }

        // do the recursion if it has sub-folders
        if (arr[a].type == "folder" && arr[a].files.length > 0) {
            arr[a]._id = ObjectId(arr[a]._id);
            removeFileReturnUpdated(arr[a].files, _id);
        }
    }

    return arr;
}

// recursive function to search uploaded files
function recursiveSearch(files, query) {
    var singleFile = null;

    for (var a = 0; a < files.length; a++) {
        const file = files[a];

        if (file.type == "folder") {
            // search folder case-insensitive
            if (file.folderName.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }

            if (file.files.length > 0) {
                singleFile = recursiveSearch(file.files, query);
                if (singleFile != null) {
                    // need parent folder in case of files
                    if (singleFile.type != "folder") {
                        singleFile.parent = file;
                    }
                    return singleFile;
                }
            }
        } else {
            if (file.name.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
        }
    }
}

// recursive function to search shared files
function recursiveSearchShared(files, query) {
    var singleFile = null;

    for (var a = 0; a < files.length; a++) {
        var file = (typeof files[a].file === "undefined") ? files[a] : files[a].file;

        if (file.type == "folder") {
            if (file.folderName.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }

            if (file.files.length > 0) {
                singleFile = recursiveSearchShared(file.files, query);
                if (singleFile != null) {
                    if (singleFile.type != "folder") {
                        singleFile.parent = file;
                    }
                    return singleFile;
                }
            }
        } else {
            if (file.name.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
        }
    }
}

// start the http server
http.listen(process.env.PORT, function () {
    console.log("Server started at " + mainURL);

    // connect with mongo DB server
    mongoClient.connect("mongodb://127.0.0.1:27017/file_transfer", {
        useUnifiedTopology: true
    }, function (error, client) {

        // connect database (it will automatically create the database if not exists)
        database = client.db("file_transfer");
        console.log("Database connected.");

        // search files or folders
        // Handle GET request to "/Search"
        app.get("/Search", async function (request, result) {
            // Get the search query parameter from the request
            const search = request.query.search;

            // Check if user is logged in
            if (request.session.user) {
                // Find the user document in the database
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });

                // Search for the file or folder in the user's uploaded and shared files
                var fileUploaded = await recursiveSearch(user.uploaded, search);
                var fileShared = await recursiveSearchShared(user.sharedWithMe, search);

                // Check if the file or folder was found in the user's uploaded or shared files
                if (fileUploaded == null && fileShared == null) {
                    // If the file or folder was not found, set an error message in the request object
                    request.status = "error";
                    request.message = "File/folder '" + search + "' is neither uploaded nor shared with you.";

                    // Render the Search template with the error message
                    result.render("Search", {
                        "request": request
                    });
                    return false;
                }

                // If the file or folder was found, set the "file" object to the found item
                var file = (fileUploaded == null) ? fileShared : fileUploaded;
                file.isShared = (fileUploaded == null);

                // Render the Search template with the found file or folder
                result.render("Search", {
                    "request": request,
                    "file": file
                });

                return false;
            }

            // If user is not logged in, redirect to Login page
            result.redirect("/Login");
        });

        // get all files shared with logged-in user
        // Renders the SharedWithMe page with the request object
        // If an _id parameter is provided in the URL, it is ignored
        app.get("/SharedWithMe/:_id?", async function (request, result) {
            result.render("SharedWithMe", {
                "request": request
            });
        });

        // This route handles the deletion of a public link from the database
        app.post("/DeleteLink", async function (request, result) {

            try {
                // Get the ID of the link to delete from the request fields
                const _id = request.fields._id;

                // Check if user is logged in
                if (request.session.user) {

                    // Find the link to delete in the database
                    var link = await database.collection("public_links").findOne({
                        $and: [{
                            "uploadedBy._id": ObjectId(request.session.user._id)
                        }, {
                            "_id": ObjectId(_id)
                        }]
                    });

                    // If the link does not exist, display an error message and redirect to the previous page
                    if (link == null) {
                        request.session.status = "error";
                        request.session.message = "Link does not exists.";

                        const backURL = request.header("Referer") || "/";
                        result.redirect(backURL);
                        return false;
                    }

                    // Delete the link from the database
                    await database.collection("public_links").deleteOne({
                        $and: [{
                            "uploadedBy._id": ObjectId(request.session.user._id)
                        }, {
                            "_id": ObjectId(_id)
                        }]
                    });

                    // Display a success message and redirect to the previous page
                    request.session.status = "success";
                    request.session.message = "Link has been deleted.";

                    const backURL = request.header("Referer") || "/";
                    result.redirect(backURL);
                    return false;

                } else {
                    // If user is not logged in, redirect to the login page
                    result.redirect("/Login");
                }

            } catch (error) {
                console.error(error);
                // Display an error message and redirect to the previous page
                request.session.status = "error";
                request.session.message = "An error occurred while deleting the link.";

                const backURL = request.header("Referer") || "/";
                result.redirect(backURL);
                return false;
            }
        });


        // Define a route for the MySharedLinks page
        app.get("/MySharedLinks", async function (request, result) {

            // Check if the user is logged in by checking their session
            if (request.session.user) {

                // If the user is logged in, query the database for public links uploaded by the user
                var links = await database.collection("public_links").find({
                    "uploadedBy._id": ObjectId(request.session.user._id)
                }).toArray();

                // Render the MySharedLinks template with the links data and request object
                result.render("MySharedLinks", {
                    "request": request,
                    "links": links
                });
                return false;
            }

            // If the user is not logged in, redirect them to the Login page
            result.redirect("/Login");
        });

        app.get("/SharedViaLink/:hash", async function (request, result) {
            const hash = request.params.hash;

            // Look up the public link in the database using the provided hash
            var link = await database.collection("public_links").findOne({
                "hash": hash
            });

            // If the link is null, it has expired, so set an error message in the session and render the page
            if (link == null) {
                request.session.status = "error";
                request.session.message = "Link expired.";

                result.render("SharedViaLink", {
                    "request": request
                });
                return false;
            }

            // If the link is still valid, render the SharedViaLink template with the link data
            result.render("SharedViaLink", {
                "request": request,
                "link": link
            });
        });

        // Handle POST request to share a file via link
        app.post("/ShareViaLink", async function (request, result) {
            try {
                // Get the ID of the file to share
                const _id = request.fields._id;

                if (request.session.user) {
                    // Get the user who is sharing the file
                    var user = await database.collection("users").findOne({
                        "_id": ObjectId(request.session.user._id)
                    });

                    // Get the file to share from the user's uploaded files
                    var file = await recursiveGetFile(user.uploaded, _id);

                    // If the file doesn't exist, redirect back to the previous page with an error message
                    if (file == null) {
                        request.session.status = "error";
                        request.session.message = "File does not exist";

                        const backURL = request.header("Referer") || "/";
                        result.redirect(backURL);
                        return false;
                    }

                    // Generate a unique hash for the shared link using the file name and store it in the public_links collection
                    bcrypt.hash(file.name, 10, async function (error, hash) {
                        if (error) {
                            throw error;
                        }
                        hash = hash.substring(10, 20);
                        const link = mainURL + "/SharedViaLink/" + hash;
                        await database.collection("public_links").insertOne({
                            "hash": hash,
                            "file": file,
                            "uploadedBy": {
                                "_id": user._id,
                                "name": user.name,
                                "email": user.email
                            },
                            "createdAt": new Date().getTime()
                        });

                        // Set the session status and message to indicate success and the generated share link
                        request.session.status = "success";
                        request.session.message = "Share link: " + link;

                        // Redirect back to the previous page with the success message
                        const backURL = request.header("Referer") || "/";
                        result.redirect(backURL);
                    });

                    return false;
                }

                // If the user is not logged in, redirect to the login page
                result.redirect("/Login");
            } catch (error) {
                console.log(error);
                result.status(500).send("Internal server error");
            }
        });


        // delete uploaded file
        app.post("/DeleteFile", async function (request, result) {
            try {
                // Get the ID of the file to be deleted from the request fields
                const _id = request.fields._id;

                // Check if the user is logged in
                if (request.session.user) {
                    // Find the user in the database
                    var user = await database.collection("users").findOne({
                        "_id": ObjectId(request.session.user._id)
                    });

                    // Remove the file from the user's uploaded files array and get the updated array
                    var updatedArray = await removeFileReturnUpdated(user.uploaded, _id);
                    // Convert the object IDs in the updated array to MongoDB ObjectIDs
                    for (var a = 0; a < updatedArray.length; a++) {
                        updatedArray[a]._id = ObjectId(updatedArray[a]._id);
                    }

                    // Update the user's uploaded files array in the database
                    await database.collection("users").updateOne({
                        "_id": ObjectId(request.session.user._id)
                    }, {
                        $set: {
                            "uploaded": updatedArray
                        }
                    });

                    // Redirect back to the previous page
                    const backURL = request.header('Referer') || '/';
                    result.redirect(backURL);
                    return false;
                }

                // Redirect to the login page if the user is not logged in
                result.redirect("/Login");
            } catch (error) {
                // Handle any errors that occur
                console.log(error);
                result.json({
                    "status": "error",
                    "message": "An error occurred while deleting the file."
                });
            }
        });


        // download file
        // Route to download a file
        app.post("/DownloadFile", async function (request, result) {
            try {
                const _id = request.fields._id;

                // Check if the file has a public link
                var link = await database.collection("public_links").findOne({
                    "file._id": ObjectId(_id)
                });

                if (link != null) {
                    // If there is a public link, read the file and send it as a response
                    fileSystem.readFile(link.file.filePath, function (error, data) {
                        if (error) throw error;
                        result.json({
                            "status": "success",
                            "message": "Data has been fetched.",
                            "arrayBuffer": data,
                            "fileType": link.file.type,
                            "fileName": link.file.name
                        });
                    });
                    return false;
                }

                if (request.session.user) {
                    // If the user is logged in, find the file in their uploaded files or files shared with them
                    var user = await database.collection("users").findOne({
                        "_id": ObjectId(request.session.user._id)
                    });

                    var fileUploaded = await recursiveGetFile(user.uploaded, _id);

                    if (fileUploaded == null) {
                        // If the file is not found in the user's uploaded files, check if it is shared with them
                        result.json({
                            "status": "error",
                            "message": "File is neither uploaded nor shared with you."
                        });
                        return false;
                    }

                    var file = fileUploaded;

                    // Read the file and send it as a response
                    fileSystem.readFile(file.filePath, function (error, data) {
                        if (error) throw error;
                        result.json({
                            "status": "success",
                            "message": "Data has been fetched.",
                            "arrayBuffer": data,
                            "fileType": file.type,
                            "fileName": file.name
                        });
                    });
                    return false;
                }

                // If the user is not logged in, send an error message
                result.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
                return false;
            } catch (error) {
                // If there's an error, send an error message
                result.json({
                    "status": "error",
                    "message": "An error occurred while fetching the file.",
                    "error": error
                });
            }
        });


        // view all files uploaded by logged-in user
        // Route to render the MyUploads page
        app.get("/MyUploads", async function (request, result) {
            // Check if the user is logged in
            if (request.session.user) {
                // Find the user in the database and get their uploaded files
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var uploaded = user.uploaded;

                // Render the MyUploads template with the uploaded files
                result.render("MyUploads", {
                    "request": request,
                    "uploaded": uploaded
                });
                return false;
            }
            // If the user is not logged in, redirect to the Login page
            result.redirect("/Login");
        });

        // upload new file
        // Define a POST endpoint for uploading a file
        // app.post("/UploadFile", async function (request, result) {
        //     try {
        //         // Check if the user is logged in
        //         if (request.session.user) {
        //             // Get the user object from the database
        //             var user = await database.collection("users").findOne({
        //                 "_id": ObjectId(request.session.user._id)
        //             });

        //             // Check if a file was uploaded
        //             if (request.files.file.size > 0) {
        //                 // Get the ID of the page where the upload button was clicked
        //                 const _id = request.fields._id;

        //                 // Create an object to store information about the uploaded file
        //                 var uploadedObj = {
        //                     "_id": ObjectId(),
        //                     "size": request.files.file.size, // in bytes
        //                     "name": request.files.file.name,
        //                     "type": request.files.file.type,
        //                     "filePath": "",
        //                     "createdAt": new Date().getTime()
        //                 };

        //                 // Generate the file path where the uploaded file will be stored
        //                 var filePath = "public/uploads/" + user.email + "/" + new Date().getTime() + "-" + request.files.file.name;
        //                 uploadedObj.filePath = filePath;

        //                 // Create the directory for the user's uploads if it doesn't exist yet
        //                 if (!fileSystem.existsSync("public/uploads/" + user.email)) {
        //                     fileSystem.mkdirSync("public/uploads/" + user.email);
        //                 }

        //                 // Read the uploaded file
        //                 fileSystem.readFile(request.files.file.path, async function (err, data) {
        //                     if (err) throw err;
        //                     console.log('File read!');

        //                     // Compress the image with lossless technique
        //                     const compressedData = await sharp(data)
        //                         .resize(1024, 1024)
        //                         .png({
        //                             compressionLevel: 9,
        //                             adaptiveFiltering: true,
        //                             force: true
        //                         })
        //                         .toBuffer();

        //                     // Write the compressed file to the specified file path
        //                     fileSystem.writeFile(filePath, compressedData, async function (err) {
        //                         if (err) throw err;
        //                         console.log('File written!');

        //                         // Add the uploaded file object to the user's "uploaded" array in the database
        //                         await database.collection("users").updateOne({
        //                             "_id": ObjectId(request.session.user._id)
        //                         }, {
        //                             $push: {
        //                                 "uploaded": uploadedObj
        //                             }
        //                         });

        //                         // Set a status message and redirect to the page where the upload button was clicked
        //                         request.session.status = "success";
        //                         request.session.message = "File has been uploaded. ";
        //                         result.redirect("/MyUploads/" + _id);
        //                     });

        //                     // Delete the uploaded file from the temporary storage
        //                     fileSystem.unlink(request.files.file.path, function (err) {
        //                         if (err) throw err;
        //                         console.log('File deleted!');
        //                     });
        //                 });

        //             } else {
        //                 // If no file was uploaded, set an error message and re-render the "MyUploads" page
        //                 request.status = "error";
        //                 request.message = "Please select a valid image.";
        //                 result.render("MyUploads", {
        //                     "request": request
        //                 });
        //             }

        //             return false;
        //         }

        //         // If the user is not logged in, redirect to the login page
        //         result.redirect("/Login");
        //     } catch (error) {
        //         console.error(error);
        //         // Set an error message and redirect to the home page
        //         request.session.status = "error";
        //         request.session.message = "An error occurred while uploading the file.";
        //         result.redirect("/");
        //     }
        // });
        app.post("/UploadFile", async function (request, result) {
            try {
              if (request.session.user) {
                var user = await database.collection("users").findOne({
                  _id: ObjectId(request.session.user._id),
                });
          
                if (request.files.file.size > 0) {
                  const _id = request.fields._id;
          
                  const uploadedObj = {
                    _id: ObjectId(),
                    size: request.files.file.size, // in bytes
                    name: request.files.file.name,
                    type: request.files.file.type,
                    filePath: "",
                    createdAt: new Date().getTime(),
                  };
          
                  const filePath =
                    "public/uploads/" +
                    user.email +
                    "/files/" +
                    new Date().getTime() +
                    "-" +
                    request.files.file.name;
          
                  uploadedObj.filePath = filePath;
          
                  if (!fileSystem.existsSync("public/uploads/" + user.email)) {
                    fileSystem.mkdirSync("public/uploads/" + user.email);
                  }
          
                  // Add the following code to create a directory for all uploads
                  if (!fileSystem.existsSync("public/uploads/" + user.email + "/files")) {
                    fileSystem.mkdirSync("public/uploads/" + user.email + "/files");
                  }
          
                  // Check if file is an image
                  const isImage = /^image\//.test(request.files.file.type);
          
                  if (isImage) {
                    // Read and compress the image file
                    let pipeline = sharp(request.files.file.path);
                    if (request.files.file.type === "image/jpeg") {
                      pipeline = pipeline.jpeg({ quality: 70 });
                    } else if (request.files.file.type === "image/png") {
                      pipeline = pipeline.png({ compressionLevel: 6 });
                    }
                    const fileBuffer = await pipeline.toBuffer();
          
                    // Write the compressed image file
                    fileSystem.writeFile(filePath, fileBuffer, async function (err) {
                      if (err) throw err;
                      console.log("File written!");
          
                      await database.collection("users").updateOne(
                        {
                          _id: ObjectId(request.session.user._id),
                        },
                        {
                          $push: {
                            uploaded: uploadedObj,
                          },
                        }
                      );
          
                      request.session.status = "success";
                      request.session.message = "File has been uploaded. ";
          
                      result.redirect("/MyUploads/" + _id);
                    });
                  } else {
                    // If the file is not an image, upload it without compression
                    fileSystem.copyFile(request.files.file.path, filePath, async function (err) {
                      if (err) throw err;
                      console.log("File written!");
          
                      await database.collection("users").updateOne(
                        {
                          _id: ObjectId(request.session.user._id),
                        },
                        {
                          $push: {
                            uploaded: uploadedObj,
                          },
                        }
                      );
          
                      request.session.status = "success";
                      request.session.message = "File has been uploaded. ";
          
                      result.redirect("/MyUploads/" + _id);
                    });
                  }
          
                  // Delete the file
                  fileSystem.unlink(request.files.file.path, function (err) {
                    if (err) throw err;
                    console.log("File deleted!");
                  });
                } else {
                  request.status = "error";
                  request.message = "Please select a valid file.";
          
                  result.render("MyUploads", {
                    request: request,
                  });
                }
          
                return false;
              }
          
              result.redirect("/Login");
            } catch (error) {
              console.error(error);
              result.status(500).send("Internal server error.");
            }
          });
          
        // logout the user
        // This route handles the user logout functionality.
        // It destroys the user session and redirects the user to the homepage.
        app.get("/Logout", function (request, result) {
            // Destroy the user session
            request.session.destroy();
            // Redirect the user to the homepage
            result.redirect("/");
        });

        // show page to login
        // Set up a route for the Login page
        app.get("/Login", function (request, result) {
            // Render the Login template, passing in the request object
            result.render("Login", {
                "request": request
            });
        });

        // authenticate the user
        // Handle POST request to "/Login" path
        app.post("/Login", async function (request, result) {
            try {
                // Extract email and password fields from request body
                var email = request.fields.email;
                var password = request.fields.password;

                // Look up user with provided email in database
                var user = await database.collection("users").findOne({
                    "email": email
                });

                // If user does not exist, show error message on login page
                if (user == null) {
                    request.status = "error";
                    request.message = "Email does not exist.";
                    result.render("Login", {
                        "request": request
                    });

                    return false;
                }

                // Compare provided password with stored hashed password
                bcrypt.compare(password, user.password, function (error, isVerify) {
                    // If passwords match, store user session and redirect to home page
                    if (isVerify) {
                        request.session.user = user;
                        result.redirect("/");
                    } else {
                        // If passwords do not match, show error message on login page
                        request.status = "error";
                        request.message = "Password is not correct.";
                        result.render("Login", {
                            "request": request
                        });
                    }
                });
            } catch (error) {
                // If an error occurs, show error message on login page
                request.status = "error";
                request.message = "An error occurred. Please try again later.";
                result.render("Login", {
                    "request": request
                });
            }
        });


        // register the user
        // This code block is handling the registration process when the user submits the registration form.
        app.post("/Register", async function (request, result) {

            // Get the user input fields from the registration form
            var name = request.fields.name;
            var email = request.fields.email;
            var password = request.fields.password;
            var reset_token = "";
            var isVerified = true;
            var verification_token = new Date().getTime();

            // Check if the user already exists in the database by querying with their email
            var user = await database.collection("users").findOne({
                "email": email
            });

            // If user does not exist, validate the password and hash it, then insert the user's data into the database
            if (user == null) {
                if (password.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[0-9a-zA-Z]{8,}$/)) {
                    bcrypt.hash(password, 10, async function (error, hash) {
                        await database.collection("users").insertOne({
                            "name": name,
                            "email": email,
                            "password": hash,
                            "reset_token": reset_token,
                            "uploaded": [],
                            "sharedWithMe": [],
                            "isVerified": isVerified,
                            "verification_token": verification_token
                        }, async function (error, data) {

                            // If user is successfully registered, show a success message and render the registration page
                            request.status = "success";
                            request.message = "Signed up successfully. You can login now.";

                            result.render("Register", {
                                "request": request
                            });

                        });
                    });
                } else {
                    // If password is invalid, show an error message and render the registration page
                    request.status = "error";
                    request.message = "Password must contain at least one digit, one lowercase letter, one uppercase letter, and be at least 8 characters long.";

                    result.render("Register", {
                        "request": request
                    });
                }
            }
            // If user already exists, show an error message and render the registration page
            else {
                request.status = "error";
                request.message = "Email already exist.";

                result.render("Register", {
                    "request": request
                });
            }
        });

        // show page to do the registration
        // This is a route handler for the "/Register" path
        app.get("/Register", function (request, result) {

            // When a GET request is made to this route, it will render the "Register" template
            // and pass in an object that contains the "request" variable
            // This will allow the "Register" template to access information about the request, if needed
            result.render("Register", {
                "request": request
            });
        });

        // home page

        // This is an example of a route in an Express.js application.
        // The route handles GET requests to the root path "/".
        app.get("/", function (request, result) {
            // The route responds by rendering the "index" view,
            // which will be a template that generates HTML markup.
            // The second argument to the render function is an object
            // that contains data to pass to the view.
            result.render("index", {
                // In this case, the data being passed to the view is the
                // entire request object, which can be accessed within the
                // view's template code.
                "request": request
            });
        });

        // search pdf
        app.get("/searchPdf", async function (request, result) {
            // Check if the user is logged in
            if (request.session.user) {
                // Find the user in the database and get their uploaded files
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });


                console.log('hello');
                result.render('searchPdf.ejs', {
                    "request": request
                });

                return false;
            }
            // If the user is not logged in, redirect to the Login page
            result.redirect("/Login");
        });
        // app.get("/searchPdf", (request, result) => {

        // });

        app.post('/searchPdfs', async (req, res) => {
            const query = req.fields.query;

            if (req.session.user) {
                try {
                    var user = await database.collection("users").findOne({
                        "_id": ObjectId(req.session.user._id)
                    });

                    const filesDir = path.join(__dirname, 'public', 'uploads', user.email);

                    // Check if user directory exists
                    if (!fs.existsSync(filesDir)) {
                        res.render('searchResults', { query, matches: [], request: req });
                        return;
                    }

                    const fileTypes = ['.pdf', '.docx', '.txt'];

                    const matches = [];

                    // Search for matches in each file type
                    for (const fileType of fileTypes) {
                        const filenames = fs.readdirSync(filesDir)
                            .filter(filename => path.extname(filename) === fileType)
                            .map(filename => path.join(filesDir, filename));

                        for (const filename of filenames) {
                            let content = '';

                            if (fileType === '.pdf') {
                                try {
                                    const doc = await pdfjsLib.getDocument(filename).promise;
                                    for (let i = 1; i <= doc.numPages; i++) {
                                        const page = await doc.getPage(i);
                                        const pageContent = await page.getTextContent();
                                        pageContent.items.forEach(item => {
                                            if (item.str.includes(query)) {
                                                matches.push({
                                                    filename: path.basename(filename),
                                                    page: i,
                                                    text: item.str
                                                });
                                            }
                                        });
                                    }
                                } catch (error) {
                                    console.error(error);
                                }
                            } else if (fileType === '.txt') {
                                try {
                                    content = fs.readFileSync(filename, 'utf-8');
                                    if (content.includes(query)) {
                                        matches.push({
                                            filename: path.basename(filename),
                                            text: content
                                        });
                                    }
                                } catch (error) {
                                    console.error(error);
                                }
                            } else if (fileType === '.docx') {
                                try {
                                    const result = await mammoth.extractRawText({ path: filename });
                                    content = result.value;
                                    if (content.includes(query)) {
                                        matches.push({
                                            filename: path.basename(filename),
                                            text: content
                                        });
                                    }
                                } catch (error) {
                                    console.error(error);
                                }
                            }
                        }
                    }
                    console.log(matches);
                    // Render the searchResults template with the search results
                    res.render('searchResults', { query, matches, request: req }, (error, html) => {
                        if (error) {
                            console.error(error);
                            res.sendStatus(500);
                        } else {
                            res.send(html);
                        }
                    });
                } catch (error) {
                    console.error(error);
                    res.sendStatus(500);
                }

                return false;
            }

            res.redirect("/Login");
        });



        app.get('/openPdf', async (req, res) => {
            try {
                const filename = req.query.filename;
                const filePath = path.join(__dirname, 'public', 'uploads', req.session.user.email, filename);

                if (req.query.page) {
                    // If a page number is specified, set it as the initial view
                    const page = Number(req.query.page);
                    const buffer = await fs.promises.readFile(filePath);
                    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
                    const pageObj = await pdf.getPage(page);
                    const viewport = pageObj.getViewport({ scale: 1 });
                    const pageData = {
                        viewport: viewport,
                        pdf: pdf,
                        page: page
                    };
                    res.render('pdfViewer', { pageData: pageData });
                } else {
                    // Otherwise, just send the file
                    res.sendFile(filePath);
                }
            } catch (error) {
                console.log(error);
                res.status(500).send("An error occurred");
            }
        });


    });
});



// app.post('/searchPdfs', async (req, res) => {
//     const query = req.fields.query;


//     if (req.session.user) {
//         var user = await database.collection("users").findOne({
//             "_id": ObjectId(req.session.user._id)
//         });

//         console.log('hi');
//         console.log(req.fields.query);
//         const filesDir = path.join(__dirname, 'files');
//         const fileTypes = ['.pdf', '.docx', '.txt'];

//         const matches = [];

//         for (const fileType of fileTypes) {
//             const filenames = fs.readdirSync(filesDir)
//                 .filter(filename => path.extname(filename) === fileType)
//                 .map(filename => path.join(filesDir, filename));

//             for (const filename of filenames) {
//                 let content = '';

//                 if (fileType === '.pdf') {
//                     const doc = await pdfjsLib.getDocument(filename).promise;
//                     for (let i = 1; i <= doc.numPages; i++) {
//                         const page = await doc.getPage(i);
//                         const pageContent = await page.getTextContent();
//                         pageContent.items.forEach(item => {
//                             if (item.str.includes(query)) {
//                                 matches.push({
//                                     filename: path.basename(filename),
//                                     page: i,
//                                     text: item.str
//                                 });
//                             }
//                         });
//                     }
//                 } else if (fileType === '.txt') {
//                     content = fs.readFileSync(filename, 'utf-8');
//                     if (content.includes(query)) {
//                         matches.push({
//                             filename: path.basename(filename),
//                             text: content
//                         });
//                     }
//                 } else if (fileType === '.docx') {
//                     const result = await mammoth.extractRawText({ path: filename });
//                     content = result.value;
//                     if (content.includes(query)) {
//                         matches.push({
//                             filename: path.basename(filename),
//                             text: content
//                         });
//                     }
//                 }
//             }
//         }

//         // Render the searchResults template with the search results
//         res.render('searchResults', { query, matches, request: req }, (error, html) => {
//             if (error) {
//                 console.error(error);
//                 res.sendStatus(500);
//             } else {
//                 res.send(html);
//             }
//         });

//         return false;
//     }

//     res.redirect("/Login");

// });