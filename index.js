const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { compareStartTimes, compareDates } = require("./sortTimeSlot");
const app = express();
const port = process.env.PORT || 5000;
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_SK);

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
    const paymentCollection = client.db("docHouseDB").collection("payments");

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
      const newDoctors = await doctorCollection
        .find({})
        .sort({ _id: -1 })
        .limit(3)
        .toArray();
      res.send(newDoctors);
    });

    app.get("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const result = await doctorCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post("/doctors", async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const result = await doctorCollection.deleteOne({
        _id: new ObjectId(id),
      });
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
      const latestReviews = await reviewCollection
        .find({})
        .sort({ _id: -1 })
        .limit(5)
        .toArray();
      res.send(latestReviews);
    });

    app.post("/reviews", verifyJWT, async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
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

      // convert createdAt entry from string to Date() object to store in db
      user.createdAt = new Date(user.createdAt);

      const insertionResult = await userCollection.insertOne(user);
      res.send(insertionResult);
    });

    app.patch("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const body = req.body;

      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: body.role,
        },
      };
      const options = { upsert: true };

      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
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

    app.post("/appointments", verifyJWT, async (req, res) => {
      const appointment = req.body;
      const result = await appointmentCollection.insertOne(appointment);
      res.send(result);
    });

    app.delete("/appointments/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await appointmentCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // appointment's payment status patching in appointments
    app.patch("/appointments/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const body = req.body;

      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };

      const updatedDoc = {
        $set: {
          payment: body.payment,
        },
      };

      const result = await appointmentCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      res.send(result);
    });

    // payment related api
    app.get("/payments", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const payments = await paymentCollection.find({ email: email }).toArray();
      res.send(payments);
    });

    app.post("/payments", verifyJWT, async (req, res) => {
      const result = await paymentCollection.insertOne(req.body);
      res.send(result);
    });

    // USER STATS API
    app.get("/dashboard/userhome", async (req, res) => {
      const email = req.query.email;
      const appointments = await appointmentCollection.count({
        email: email,
      });
      const payments = await paymentCollection.count({
        email: email,
      });
      const reviews = await reviewCollection.count({
        email: email,
      });

      res.send({ appointments, payments, reviews });
    });

    // PAYMENT RELATED API
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(parseFloat(price) * 100);

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // ADMIN STATS API
    app.get(
      "/dashboard/adminhome",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const doctorCount = await doctorCollection.estimatedDocumentCount();
        const patientCount = await userCollection.estimatedDocumentCount();
        const appointmentCount =
          await appointmentCollection.estimatedDocumentCount();

        const patientCountsByYear = await userCollection
          .aggregate([
            {
              $group: {
                _id: { $year: "$createdAt" },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                year: "$_id",
                count: 1,
                _id: 0,
              },
            },
          ])
          .toArray();

        // Count paid payments
        const paidCount = await appointmentCollection.countDocuments({
          "payment.status": "paid",
        });

        // Count unpaid payments
        const unpaidCount = await appointmentCollection.countDocuments({
          payment: { $exists: false },
        });

        const paymentCount = [
          {
            status: "Paid Appointments",
            count: paidCount,
          },
          {
            status: "Pending Appointments",
            count: unpaidCount,
          },
        ];

        res.send({
          doctorCount,
          patientCount,
          appointmentCount,
          patientCountsByYear,
          paymentCount,
        });
      }
    );

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
