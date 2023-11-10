const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { compareStartTimes, compareDates } = require("./sortTimeSlot");
const app = express();
const port = process.env.PORT || 5000;
const jwt = require("jsonwebtoken");

// middleware
app.use(cors());
app.use(express.json());

// Verify JWT Token Middleware
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }

    req.decoded = decoded;
    next();
  });
};

// MONGO DB CONNECTION
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5732rtt.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const doctorCollection = client.db("docHouseDB").collection("doctors");
    const reviewCollection = client.db("docHouseDB").collection("reviews");
    const serviceCollection = client.db("docHouseDB").collection("services");
    const userCollection = client.db("docHouseDB").collection("users");
    const appointmentCollection = client
      .db("docHouseDB")
      .collection("appointments");

    // generate JWT Token related api
    app.post("/jwt", async (req, res) => {
      const userEmailObj = req.body;

      const token = jwt.sign(userEmailObj, process.env.JWT_SECRET_KEY, {
        expiresIn: "2h",
      });

      res.send({ token });
    });

    // server side admin verification middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req?.decoded.userEmail;
      const user = await userCollection.findOne({ email: email });

      if (user?.role !== "admin") {
        return res.send({ message: "forbidden access" });
      }
      next();
    };

    // doctors related api
    app.get("/doctors", async (req, res) => {
      const result = await doctorCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const result = await doctorCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // services related api
    app.get("/services", async (req, res) => {
      const result = await serviceCollection.find({}).toArray();

      const sortedResult = result.map((service) => ({
        ...service,
        availableSlot: [...service.availableSlot].sort(compareStartTimes),
      }));

      res.send(sortedResult);
    });

    app.patch("/services/:action", async (req, res) => {
      const action = req.params.action;

      // adds booked date the selected time slot
      if (action === "addDate") {
        const { _id, bookedSlotTime, bookedDate } = req.body;

        // finding the service
        const service = await serviceCollection.findOne({
          _id: new ObjectId(_id),
        });

        // finding selected time slot object from available slot times
        const selectedSlot = service?.availableSlot.find(
          (slotObj) => slotObj.slot === bookedSlotTime
        );
        // adding the booked date to bookedDates array of the selected time slot object
        selectedSlot.bookedDates = [...selectedSlot.bookedDates, bookedDate];

        // filtering rest(un-updated) available time slots
        const restAvailableSlots = service?.availableSlot.filter(
          (slotObj) => slotObj.slot !== bookedSlotTime
        );

        // creating new available slots with updated and un-updated slots
        const newAvailableSlots = [...restAvailableSlots, selectedSlot];

        // updating the service object
        const updatedService = {
          $set: {
            availableSlot: newAvailableSlots,
          },
        };

        const result = await serviceCollection.updateOne(
          { _id: new ObjectId(_id) },
          updatedService,
          { upsert: true }
        );
        res.send(result);
      } else if (action === "deleteDate") {
        const { serviceName, bookedSlotTime, bookedDate } = req.body;

        // finding the service
        const service = await serviceCollection.findOne({
          serviceName: serviceName,
        });

        // finding selected time slot object from available slot times
        const selectedSlot = service?.availableSlot.find(
          (slotObj) => slotObj.slot === bookedSlotTime
        );

        // updating selected time slot
        const restBookedDates = selectedSlot.bookedDates.filter(
          (date) => date !== bookedDate
        );
        selectedSlot.bookedDates = [...restBookedDates];

        // filtering rest(un-updated) available time slots
        const restAvailableSlots = service?.availableSlot.filter(
          (slotObj) => slotObj.slot !== bookedSlotTime
        );

        // creating new available slots with updated and un-updated slots
        const newAvailableSlots = [...restAvailableSlots, selectedSlot];

        // updating the service object
        const updatedService = {
          $set: {
            availableSlot: newAvailableSlots,
          },
        };

        const result = await serviceCollection.updateOne(
          { serviceName: serviceName },
          updatedService,
          { upsert: true }
        );
        res.send(result);
      }
    });

    // reviews related api
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find({}).toArray();
      res.send(result);
    });

    // users related api

    // admin route
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      // check if the user already exists
      const userExists = await userCollection.findOne({ email: user.email });
      if (userExists) {
        return res.send({ message: "message already exists" });
      }

      const insertionResult = await userCollection.insertOne(user);
      res.send(insertionResult);
    });

    // api to check if a user is admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded?.userEmail) return res.send({ isAdmin: false });

      const user = await userCollection.findOne({ email: email });
      if (user?.role !== "admin") {
        return res.send({ isAdmin: false });
      }

      res.send({ isAdmin: true });
    });

    // user appointments related api
    app.get("/appointments", verifyJWT, async (req, res) => {
      const userEmail = req.query.email;
      const result = await appointmentCollection
        .find({ email: userEmail })
        .toArray();

      result.sort(
        (a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate)
      );

      res.send(result);
    });
    app.post("/appointments", async (req, res) => {
      const appointment = req.body;
      const result = await appointmentCollection.insertOne(appointment);
      res.send(result);
    });

    app.delete("/appointments/:id", async (req, res) => {
      const id = req.params.id;
      const result = await appointmentCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Doc House server is up and running");
});

app.listen(port, () => {
  console.log("Doc House server is running on port: ", port);
});
